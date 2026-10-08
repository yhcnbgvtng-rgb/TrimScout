/**
 * REQUIRE_BUYER_LOGIN — whether a buyer must sign in to send a quote request.
 *
 * Default true (today's behaviour). Set it to false (Vercel env + redeploy) and
 * a visitor can enter VINs, pick cars, run the quote wizard and send an RFQ as a
 * guest, identified only by the email they type. Every server route that guards
 * a buyer action funnels through here, so the flag is enforced on the server and
 * not just hidden in the UI: with the flag on, a guest token is never honoured.
 *
 * A guest request is owned by `guest:<email>` (the box stores buyerUserId as a
 * string, so no box change) and is opened with an unguessable link:
 * HMAC-SHA256(rfqId) keyed by LIGHTSAIL_API_KEY — the same signing approach as the
 * dealer unsubscribe link. Possession of the link is the credential.
 *
 * SAFE MODE is not touched here: every request still waits for admin approval and
 * every outbound email still goes to SAFE_MODE_RECIPIENT.
 */
import { env } from "node:process";
import { createHmac, timingSafeEqual } from "node:crypto";
import { serverSecret } from "./serverSecret";

export const GUEST_PREFIX = "guest:";
export const GUEST_TOKEN_HEADER = "x-guest-token";
const EMAIL_SHAPE = /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]{2,}$/;

/** Only an explicit 0/false/no/off turns the login requirement off; anything else (unset, junk) keeps it on. */
export function requireBuyerLogin(source: Record<string, string | undefined> = env as Record<string, string | undefined>): boolean {
  const raw = source.REQUIRE_BUYER_LOGIN;
  if (raw == null || raw.trim() === "") return true;
  return !/^(0|false|no|off)$/i.test(raw.trim());
}

export function normalizeGuestEmail(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const e = raw.trim().toLowerCase();
  return e.length <= 200 && EMAIL_SHAPE.test(e) ? e : null;
}

export const guestBuyerId = (email: string): string => `${GUEST_PREFIX}${email}`;
export const isGuestBuyerId = (id: unknown): id is string => typeof id === "string" && id.startsWith(GUEST_PREFIX);
export const guestEmailFromId = (id: string): string | null => (isGuestBuyerId(id) ? normalizeGuestEmail(id.slice(GUEST_PREFIX.length)) : null);

export function guestTokenFor(rfqId: string | number): string {
  return createHmac("sha256", serverSecret("LIGHTSAIL_API_KEY")).update(`guest-rfq:${rfqId}`).digest("hex");
}

export function verifyGuestToken(rfqId: string | number, token: unknown): boolean {
  if (typeof token !== "string" || !/^[0-9a-f]{64}$/.test(token)) return false;
  if (!serverSecret("LIGHTSAIL_API_KEY")) return false;
  return timingSafeEqual(Buffer.from(guestTokenFor(rfqId), "hex"), Buffer.from(token, "hex"));
}

export const guestTrackerPath = (rfqId: string | number): string => `/rfq/${rfqId}?t=${guestTokenFor(rfqId)}`;

export function guestTokenFromRequest(req: Request): string | null {
  const h = req.headers.get(GUEST_TOKEN_HEADER);
  if (h) return h;
  try {
    return new URL(req.url).searchParams.get("t");
  } catch {
    return null;
  }
}

export interface BuyerIdentity {
  id: string;
  email: string | null;
  role: string;
  guest: boolean;
  isAdmin: boolean;
}

interface SessionLike {
  user?: { id?: unknown; email?: string | null; role?: unknown } | null;
}

/** The signed-in user as an identity, or null. */
export function sessionIdentity(session: SessionLike | null | undefined): BuyerIdentity | null {
  const u = session?.user;
  if (!u?.id) return null;
  return { id: String(u.id), email: u.email ?? null, role: String(u.role ?? ""), guest: false, isAdmin: u.role === "admin" };
}

/**
 * Who is acting on this RFQ: the session user, or — only when login is not required —
 * the guest who holds the request's signed link. Null → respond 401.
 */
export function buyerForRfq(
  session: SessionLike | null | undefined,
  req: Request,
  rfq: { id: string | number; buyerUserId: string },
  source?: Record<string, string | undefined>
): BuyerIdentity | null {
  const s = sessionIdentity(session);
  if (s) return s;
  if (requireBuyerLogin(source)) return null;
  if (!isGuestBuyerId(rfq.buyerUserId)) return null;
  if (!verifyGuestToken(rfq.id, guestTokenFromRequest(req))) return null;
  return { id: rfq.buyerUserId, email: guestEmailFromId(rfq.buyerUserId), role: "buyer", guest: true, isAdmin: false };
}

/** Cheap pre-check before fetching the RFQ: is there any credential at all? */
export function hasBuyerCredential(session: SessionLike | null | undefined, req: Request, source?: Record<string, string | undefined>): boolean {
  if (session?.user?.id) return true;
  return !requireBuyerLogin(source) && Boolean(guestTokenFromRequest(req));
}

export type RfqCreateActor =
  | { kind: "buyer"; ownerId: string }
  | { kind: "guest"; ownerId: string; email: string }
  | { kind: "deny"; status: number; error: string; code?: string };

/**
 * Who is creating an RFQ. A signed-in buyer, always. A guest only while REQUIRE_BUYER_LOGIN is off, only
 * with no session at all (a signed-in dealer/admin keeps the buyer-only refusal) and only with a valid email.
 */
export function rfqCreateActor(session: SessionLike | null | undefined, body: { guestEmail?: unknown } | null | undefined, source?: Record<string, string | undefined>): RfqCreateActor {
  const u = session?.user;
  if (u?.id && u.role === "buyer") return { kind: "buyer", ownerId: String(u.id) };
  if (u || requireBuyerLogin(source)) return { kind: "deny", status: 401, error: "You must be signed in as a buyer to send an RFQ." };
  const email = normalizeGuestEmail(body?.guestEmail);
  if (!email) return { kind: "deny", status: 400, error: "Enter a valid email so we can send you your deal tracker link.", code: "guest_email_required" };
  return { kind: "guest", ownerId: guestBuyerId(email), email };
}
