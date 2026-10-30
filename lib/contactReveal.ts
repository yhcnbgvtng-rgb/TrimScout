/**
 * The dealer's "Reveal buyer contact info" flow, as plain functions the route and the tests share.
 *
 * Gates, in order: IP rate limit -> signed token (valid, unexpired, bound to one invite) -> per-token rate limit -> the invite is
 * the finally accepted, not-closed-out winner (checked here from the request and again on the box) -> the box stamps and logs
 * the reveal and returns the details. The token names the invite, so one dealer's link can never open another dealer's deal.
 * If the box cannot log the reveal, nothing is revealed (fail closed). A request, not a bid.
 */
import { verifyRevealToken, type RevealTokenClaims, type RevealTokenResult } from "./contactRevealToken";
import { namedLimit, retryAfterLabel } from "./rateLimit";
import { isFinallyAccepted } from "./dealThread";
import type { RfqInvite, RfqRequest } from "./rfq";
import { RfqApiError } from "./rfqApi";

export interface RevealContact { name: string | null; email: string; phone: string | null; zip: string | null }
export interface RevealDeps {
  getRfq: (id: string) => Promise<RfqRequest | null>;
  revealOnBox: (rfqId: string, inviteId: string) => Promise<{ contact: RevealContact; reveals: { count: number; firstAt: string | null; lastAt: string | null } }>;
  now?: number;
}
export interface RevealSummary { vehicle: string; vin: string; acceptedOtd: number | null; netAfterTrade: number | null; expiresAt: number }
export type RevealOutcome =
  | { status: 200; body: { contact: RevealContact; viewedAt: string | null } }
  | { status: 200; body: { summary: RevealSummary } }
  | { status: 400 | 403 | 404 | 409 | 410 | 429 | 502 | 503; body: { error: string; retryAfterSec?: number } };

const FAIL: Record<Exclude<Extract<RevealTokenResult, { ok: false }>["reason"], never>, { status: 400 | 403 | 410; error: string }> = {
  malformed: { status: 400, error: "This link isn't valid." },
  bad_signature: { status: 403, error: "This link isn't valid." },
  expired: { status: 410, error: "This link has expired (links last 30 days). Ask the buyer to reply from their TrimScout deal page." },
};

/** The winner's own invite, or why not. */
function winnerInvite(rfq: RfqRequest | null, inviteId: string): { invite: RfqInvite } | { error: string; status: 404 | 409 } {
  const invite = rfq?.invites.find((i) => i.id === inviteId);
  if (!rfq || !invite) return { status: 404, error: "This quote request was not found." };
  if (invite.notSelectedAt || !isFinallyAccepted(rfq, invite) || !invite.stage?.release) return { status: 409, error: "There is no buyer contact info to show on this quote request." };
  return { invite };
}

type Gate = { out: RevealOutcome } | { out?: undefined; claims: RevealTokenClaims; rfq: RfqRequest; invite: RfqInvite };
async function gate(token: unknown, ip: string, deps: RevealDeps): Promise<Gate> {
  const now = deps.now;
  const byIp = namedLimit("contact_reveal_ip", ip, now);
  if (!byIp.ok) return { out: { status: 429 as const, body: { error: `Too many tries. Try again in ${retryAfterLabel(byIp.retryAfterSec)}.`, retryAfterSec: byIp.retryAfterSec } } };
  const v = verifyRevealToken(token, now);
  if (!v.ok) return { out: { status: FAIL[v.reason].status, body: { error: FAIL[v.reason].error } } };
  const byToken = namedLimit("contact_reveal_token", `${v.claims.rfqId}:${v.claims.inviteId}`, now);
  if (!byToken.ok) return { out: { status: 429 as const, body: { error: `Too many tries. Try again in ${retryAfterLabel(byToken.retryAfterSec)}.`, retryAfterSec: byToken.retryAfterSec } } };
  const rfq = await deps.getRfq(v.claims.rfqId).catch(() => null);
  const w = winnerInvite(rfq, v.claims.inviteId);
  if ("error" in w) return { out: { status: w.status, body: { error: w.error } } };
  return { claims: v.claims, rfq: rfq as RfqRequest, invite: w.invite };
}

/** GET: what the page shows before the button is pressed. Never the buyer's details, and not a reveal. */
export async function describeReveal(token: unknown, ip: string, deps: RevealDeps): Promise<RevealOutcome> {
  const g = await gate(token, ip, deps);
  if (g.out) return g.out;
  const vehicle = [g.rfq.vehicleYear, g.rfq.vehicleMake, g.rfq.vehicleModel, g.rfq.vehicleTrim].filter(Boolean).join(" ") || "vehicle";
  const s = g.invite.stage?.final?.summary;
  return { status: 200, body: { summary: { vehicle, vin: g.invite.vehicle?.vin || g.rfq.vin || "", acceptedOtd: s ? s.otd : null, netAfterTrade: s && s.tradeValue != null ? s.trueOtd : null, expiresAt: g.claims.expiresAt } } };
}

/** POST: the button. Logged on the box before anything is returned. */
export async function performReveal(token: unknown, ip: string, deps: RevealDeps): Promise<RevealOutcome> {
  const g = await gate(token, ip, deps);
  if (g.out) return g.out;
  try {
    const r = await deps.revealOnBox(g.claims.rfqId, g.claims.inviteId);
    return { status: 200, body: { contact: r.contact, viewedAt: r.reveals?.lastAt ?? null } };
  } catch (err) {
    if (err instanceof RfqApiError && (err.status === 409 || err.status === 404)) return { status: 409, body: { error: "There is no buyer contact info to show on this quote request." } };
    return { status: 503, body: { error: "We couldn't open the contact info just now. Try again in a minute." } };
  }
}
