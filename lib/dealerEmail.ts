/**
 * Emails invited dealers when a buyer submits an offer.
 *
 * ================================================================
 * SAFETY OVERRIDE — set at the site owner's explicit instruction
 * (2026-09-05): "NEVER EMAIL ANYONE ON THIS LIST, always email
 * pausmi@outlook.com until i say otherwise."
 *
 * Every email this module sends goes to SAFE_MODE_RECIPIENT below,
 * regardless of what contact is on file for the invited dealer.
 * sendViaResend() has no `to` parameter — there is structurally
 * nowhere for a real dealer address to slot in. Do NOT add one, and
 * do NOT remove or bypass this override without the site owner
 * explicitly saying so in a future instruction.
 * ================================================================
 */

import { listDealerships, type Dealership } from "./dealershipsApi";
import { invitedDealersFromVehicles, normalizeDealerKey, type InvitedDealerSeed } from "./dealEngagement";
import { reviewTargetFromVehicle } from "./fordCompetitionUi";
import { formatDealStructures } from "./dealStructure";
import { serverSecret } from "./serverSecret";
import type { BiddingRequest } from "./types";

export const SAFE_MODE_RECIPIENT = "pausmi@outlook.com";

const RESEND_API_URL = "https://api.resend.com/emails";
// Resend's shared onboarding address works with zero setup (no domain
// verification) — swap DEALER_EMAIL_FROM once a real sending domain is
// verified on the Resend account.
const FROM_ADDRESS = process.env.DEALER_EMAIL_FROM || "TrimScout <onboarding@resend.dev>";

export interface DealerEmailResult {
  dealerName: string;
  sent: boolean;
  /** The dealership directory's contact email, for the email body only — never the actual recipient. See the safety override above. */
  resolvedContactEmail: string | null;
  error?: string;
}

function escapeHtml(s: string): string {
  const map: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  return s.replace(/[&<>"']/g, (c) => map[c]);
}

async function loadDealerships(): Promise<Dealership[]> {
  try {
    return await listDealerships();
  } catch (err) {
    console.error("dealerEmail: could not load dealership directory —", err instanceof Error ? err.message : err);
    return [];
  }
}

function findContactEmail(dealerships: Dealership[], seed: InvitedDealerSeed): string | null {
  const key = normalizeDealerKey(seed.dealerName);
  const matches = dealerships.filter((d) => normalizeDealerKey(d.dealerName) === key);
  const byState = matches.find((d) => (d.state || "").trim().toUpperCase() === seed.dealerState.toUpperCase());
  const match = byState || matches[0];
  const email = match?.contactEmail?.trim();
  return email || null;
}

export function buildOfferEmail(
  seed: InvitedDealerSeed,
  resolvedContactEmail: string | null,
  request: BiddingRequest
): { subject: string; html: string } {
  const target = reviewTargetFromVehicle(request.targetVehicle);
  const vehicleLine = target?.title || "a vehicle";
  const paymentLabel = formatDealStructures(request.dealStructurePreferences?.requestedStructures || []) || "Not specified";
  const otdLine =
    typeof request.targetOtdPrice === "number" && request.targetOtdPrice > 0
      ? `Target out-the-door price: $${request.targetOtdPrice.toLocaleString("en-US")}`
      : "No fixed target price — open reverse auction.";

  const subject = `[SAFE MODE] New buyer offer for ${seed.dealerName} — ${vehicleLine}`;
  const html = `
<div style="font-family:sans-serif;font-size:14px;color:#111;line-height:1.5;">
  <p style="background:#fff3cd;border:1px solid #ffe69c;padding:10px 14px;border-radius:6px;">
    <strong>SAFE MODE:</strong> this notification was redirected here instead of the dealer, per site-owner override.<br/>
    Intended dealer: <strong>${escapeHtml(seed.dealerName)}</strong>${
      seed.dealerCity || seed.dealerState
        ? ` (${escapeHtml([seed.dealerCity, seed.dealerState].filter(Boolean).join(", "))})`
        : ""
    }<br/>
    Contact on file: ${resolvedContactEmail ? escapeHtml(resolvedContactEmail) : "<em>none found in the dealership directory</em>"}
  </p>
  <p>A buyer submitted a new offer for <strong>${escapeHtml(vehicleLine)}</strong>${
    target?.vin ? ` (VIN ${escapeHtml(target.vin)})` : ""
  }.</p>
  <p>Payment: ${escapeHtml(paymentLabel)}<br/>${escapeHtml(otdLine)}</p>
  <p style="color:#666;font-size:12px;">Deal request ID: ${escapeHtml(request.id)}</p>
</div>`.trim();
  return { subject, html };
}

/** Returns false (not an error) when RESEND_API_KEY isn't configured — nothing was sent, but nothing failed either. */
async function sendViaResend(subject: string, html: string): Promise<boolean> {
  const apiKey = serverSecret("RESEND_API_KEY");
  if (!apiKey) {
    console.warn(`dealerEmail: RESEND_API_KEY not set — would have emailed ${SAFE_MODE_RECIPIENT}: "${subject}"`);
    return false;
  }
  const res = await fetch(RESEND_API_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: FROM_ADDRESS, to: [SAFE_MODE_RECIPIENT], subject, html }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Resend request failed (${res.status}): ${text.slice(0, 300)}`);
  }
  return true;
}

/**
 * Notifies every dealer invited on this deal (the favorite's dealer plus
 * any other lots') that a buyer submitted an offer. One email per dealer,
 * each naming that dealer — but per the safety override above, every send
 * actually lands at SAFE_MODE_RECIPIENT. Never throws: a notification
 * failure must never fail the buyer's own request.
 */
export async function notifyDealersOfNewOffer(request: BiddingRequest): Promise<DealerEmailResult[]> {
  const seeds = invitedDealersFromVehicles(request.targetVehicle, request.otherLots);
  if (seeds.length === 0) return [];

  const dealerships = await loadDealerships();
  const results: DealerEmailResult[] = [];
  for (const seed of seeds) {
    const resolvedContactEmail = findContactEmail(dealerships, seed);
    const { subject, html } = buildOfferEmail(seed, resolvedContactEmail, request);
    try {
      const sent = await sendViaResend(subject, html);
      results.push({
        dealerName: seed.dealerName,
        sent,
        resolvedContactEmail,
        ...(sent ? {} : { error: "RESEND_API_KEY not configured" }),
      });
    } catch (err) {
      console.error(`dealerEmail: send failed for ${seed.dealerName} —`, err instanceof Error ? err.message : err);
      results.push({
        dealerName: seed.dealerName,
        sent: false,
        resolvedContactEmail,
        error: err instanceof Error ? err.message : "send failed",
      });
    }
  }
  return results;
}
