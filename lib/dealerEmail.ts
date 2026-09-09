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
import {
  invitedDealersFromVehicles,
  looksLikeTruncatedDealerName,
  normalizeDealerKey,
  type InvitedDealerSeed,
} from "./dealEngagement";
import { reviewTargetFromVehicle } from "./fordCompetitionUi";
import { formatDealStructures } from "./dealStructure";
import { serverSecret } from "./serverSecret";
import { unsubscribeUrlFor, DEALER_EMAIL_BASE_URL } from "./dealerUnsubscribe";
import { dealerSignupInviteUrl } from "./dealerSignupInvite";
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

const UNSUBSCRIBED_ERROR = "dealer unsubscribed";

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

function findDealershipMatch(dealerships: Dealership[], seed: InvitedDealerSeed): Dealership | null {
  const key = normalizeDealerKey(seed.dealerName);
  const matches = dealerships.filter((d) => normalizeDealerKey(d.dealerName) === key);
  const byState = matches.find((d) => (d.state || "").trim().toUpperCase() === seed.dealerState.toUpperCase());
  return byState || matches[0] || null;
}

export function buildOfferEmail(
  seed: InvitedDealerSeed,
  resolvedContactEmail: string | null,
  request: BiddingRequest,
  unsubscribeUrl: string | null,
  /** Only ever set when the dealer matched a real dealership_contacts row — an unmatched dealer has no directory id to build the invite from. */
  signupUrl: string | null
): { subject: string; html: string } {
  const target = reviewTargetFromVehicle(request.targetVehicle);
  const vehicleLine = target?.title || "a vehicle";
  const paymentLabel = formatDealStructures(request.dealStructurePreferences?.requestedStructures || []) || "Not specified";
  const hasTargetOtd = typeof request.targetOtdPrice === "number" && request.targetOtdPrice > 0;
  const otdLine = hasTargetOtd
    ? `$${request.targetOtdPrice!.toLocaleString("en-US")}`
    : "No fixed target — open reverse auction";

  const subject = `[SAFE MODE] New buyer offer for ${seed.dealerName} — ${vehicleLine}`;
  const photo = request.targetVehicle?.imageUrl || null;
  const dealerLocationLine = [seed.dealerCity, seed.dealerState].filter(Boolean).join(", ");

  const html = `
<div style="background:#f1f5f9;padding:32px 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e2e8f0;">

    <tr>
      <td style="padding:24px 32px;border-bottom:1px solid #e2e8f0;">
        <table role="presentation" cellpadding="0" cellspacing="0">
          <tr>
            <td style="padding-right:8px;vertical-align:middle;">
              <img src="${DEALER_EMAIL_BASE_URL}/scoutmark.png" width="28" height="28" alt="TrimScout" style="display:block;border-radius:6px;" />
            </td>
            <td style="vertical-align:middle;">
              <span style="font-size:18px;font-weight:800;color:#0f172a;letter-spacing:-0.02em;">Trim<span style="color:#059669;">Scout</span></span>
            </td>
          </tr>
        </table>
      </td>
    </tr>

    <tr>
      <td style="padding:24px 32px 0;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#fffbeb;border:1px solid #fde68a;border-radius:10px;">
          <tr>
            <td style="padding:12px 16px;font-size:12px;line-height:1.6;color:#78350f;">
              <strong>SAFE MODE:</strong> this notification was redirected here instead of the dealer, per site-owner override.<br/>
              Intended dealer: <strong>${escapeHtml(seed.dealerName)}</strong>${
                dealerLocationLine ? ` (${escapeHtml(dealerLocationLine)})` : ""
              }<br/>
              Contact on file: ${resolvedContactEmail ? escapeHtml(resolvedContactEmail) : "<em>none found in the dealership directory</em>"}
            </td>
          </tr>
        </table>
      </td>
    </tr>

    <tr>
      <td style="padding:28px 32px 4px;">
        <h1 style="margin:0;font-size:20px;font-weight:800;color:#0f172a;letter-spacing:-0.01em;">New buyer offer</h1>
        <p style="margin:6px 0 0;font-size:14px;color:#64748b;">A buyer wants to move forward on this vehicle at ${escapeHtml(seed.dealerName)}.</p>
      </td>
    </tr>

    <tr>
      <td style="padding:20px 32px 0;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;">
          <tr>
            ${
              photo
                ? `<td width="96" style="padding:16px 0 16px 16px;vertical-align:top;">
                     <img src="${escapeHtml(photo)}" width="80" height="60" alt="" style="display:block;width:80px;height:60px;border-radius:8px;object-fit:cover;background:#e2e8f0;" />
                   </td>`
                : ""
            }
            <td style="padding:16px;vertical-align:top;">
              <div style="font-size:15px;font-weight:700;color:#0f172a;">${escapeHtml(vehicleLine)}</div>
              ${target?.vin ? `<div style="margin-top:2px;font-size:12px;color:#64748b;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;">VIN ${escapeHtml(target.vin)}</div>` : ""}
            </td>
          </tr>
        </table>
      </td>
    </tr>

    <tr>
      <td style="padding:16px 32px 0;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td style="padding:8px 0;font-size:13px;color:#64748b;border-bottom:1px solid #f1f5f9;">Payment</td>
            <td style="padding:8px 0;font-size:13px;color:#0f172a;font-weight:600;text-align:right;border-bottom:1px solid #f1f5f9;">${escapeHtml(paymentLabel)}</td>
          </tr>
          <tr>
            <td style="padding:8px 0;font-size:13px;color:#64748b;">${hasTargetOtd ? "Target out-the-door price" : "Pricing"}</td>
            <td style="padding:8px 0;font-size:14px;color:#059669;font-weight:800;text-align:right;">${escapeHtml(otdLine)}</td>
          </tr>
        </table>
      </td>
    </tr>

    ${
      signupUrl
        ? `<tr>
             <td style="padding:24px 32px 4px;">
               <table role="presentation" cellpadding="0" cellspacing="0">
                 <tr>
                   <td style="border-radius:10px;background:#059669;">
                     <a href="${escapeHtml(signupUrl)}" style="display:inline-block;padding:12px 24px;font-size:14px;font-weight:700;color:#ffffff;text-decoration:none;">Sign In / Sign Up to Respond</a>
                   </td>
                 </tr>
               </table>
             </td>
           </tr>
           <tr>
             <td style="padding:10px 32px 0;">
               <p style="margin:0;font-size:12px;color:#94a3b8;">Create your free TrimScout dealer account — it's pre-filled for ${escapeHtml(seed.dealerName)} — to see this request and send back your best price.</p>
             </td>
           </tr>`
        : ""
    }

    <tr>
      <td style="padding:28px 32px 24px;">
        <p style="margin:0;font-size:11px;color:#94a3b8;">Deal request ID: ${escapeHtml(request.id)}</p>
      </td>
    </tr>

    ${
      unsubscribeUrl
        ? `<tr>
             <td style="padding:16px 32px 24px;border-top:1px solid #e2e8f0;">
               <p style="margin:0;font-size:11px;color:#94a3b8;">Don't want emails like this about buyer offers? <a href="${escapeHtml(unsubscribeUrl)}" style="color:#64748b;">Unsubscribe</a>.</p>
             </td>
           </tr>`
        : ""
    }
  </table>
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
    const match = findDealershipMatch(dealerships, seed);
    const resolvedContactEmail = match?.contactEmail?.trim() || null;

    // Not an error — a legitimately unmatched dealer (no directory entry
    // yet) is normal and common. This is specifically for the case a
    // real match likely exists but the name doesn't line up because the
    // source data itself got clipped by a fixed-width field somewhere
    // upstream (confirmed on a real Ford sticker — see
    // looksLikeTruncatedDealerName's own comment). A quiet log line so a
    // human can go fix the contact record, instead of this failing the
    // same way forever with nothing to notice it by.
    if (!match && looksLikeTruncatedDealerName(seed.dealerName)) {
      console.warn(
        `dealerEmail: "${seed.dealerName}" didn't match any dealership_contacts row and looks like it may be truncated (length ${seed.dealerName.trim().length}) — check the source data and the contact record's exact name.`
      );
    }

    if (match?.emailOptOut) {
      results.push({ dealerName: seed.dealerName, sent: false, resolvedContactEmail, error: UNSUBSCRIBED_ERROR });
      continue;
    }

    const unsubscribeUrl = match ? unsubscribeUrlFor(match.id) : null;
    const signupUrl = match ? dealerSignupInviteUrl(match.id) : null;
    const { subject, html } = buildOfferEmail(seed, resolvedContactEmail, request, unsubscribeUrl, signupUrl);
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
