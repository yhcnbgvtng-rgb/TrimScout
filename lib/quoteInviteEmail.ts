/**
 * The one email a desk receives for a quote request package. Pure: builds
 * subject + HTML from the invite, the package, and the tracked link. Sending
 * goes through lib/dealerEmail.ts and its SAFE MODE override.
 *
 * What it must do: name the exact car and where it sits, say in plain words
 * that this is a request and not a bid, tell the desk how to answer (reply
 * with an out-the-door number), and carry the tracked link that marks the
 * invite "viewed" when opened. What it must never do: show the buyer's name,
 * email, phone or ZIP.
 */

import { NON_BINDING_COPY, DESK_ROLE_LABELS, type DeskRole } from "./quotePackage";

export interface QuoteInviteEmailInput {
  dealerName: string;
  contactName: string;
  role: DeskRole | string;
  vehicle: { year: number; make: string; model: string; trim: string; vin: string; vdpUrl: string | null };
  buyerAlias: string;
  dealReference: string | null;
  /** Tracked link — marks the invite viewed, then lands on the how-to-reply page. */
  viewUrl: string;
  unsubscribeUrl: string | null;
  /** How the buyer wants to pay, as a label ("Cash", "Finance or Lease"). */
  paymentLabel: string | null;
  purchaseTimelineLabel: string | null;
}

function escapeHtml(s: string): string {
  const map: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  return s.replace(/[&<>"']/g, (c) => map[c]);
}

export function quoteInviteSubject(input: QuoteInviteEmailInput): string {
  const car = [input.vehicle.year, input.vehicle.make, input.vehicle.model, input.vehicle.trim].filter(Boolean).join(" ");
  return `Quote request: ${car} (VIN …${input.vehicle.vin.slice(-6)}) — ${input.buyerAlias}`;
}

export function quoteInviteHtml(input: QuoteInviteEmailInput): string {
  const car = [input.vehicle.year, input.vehicle.make, input.vehicle.model, input.vehicle.trim].filter(Boolean).join(" ");
  const roleLabel = (DESK_ROLE_LABELS as Record<string, string>)[input.role] || "Sales";
  const firstName = input.contactName.split(/\s+/)[0] || input.contactName;
  const listing = input.vehicle.vdpUrl
    ? `<a href="${escapeHtml(input.vehicle.vdpUrl)}" style="color:#059669">your listing</a>`
    : "your listing";

  return `
  <div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:600px;margin:0 auto;color:#0f172a;line-height:1.5">
    <p style="font-size:15px">Hi ${escapeHtml(firstName)},</p>
    <p>A buyer on TrimScout would like an out-the-door quote on a car in your inventory:</p>
    <table style="border-collapse:collapse;width:100%;margin:12px 0;font-size:14px">
      <tr><td style="padding:6px 0;color:#64748b;width:120px">Vehicle</td><td style="padding:6px 0;font-weight:700">${escapeHtml(car)}</td></tr>
      <tr><td style="padding:6px 0;color:#64748b">VIN</td><td style="padding:6px 0;font-family:ui-monospace,Menlo,monospace">${escapeHtml(input.vehicle.vin)}</td></tr>
      <tr><td style="padding:6px 0;color:#64748b">Listing</td><td style="padding:6px 0">${listing}</td></tr>
      ${input.paymentLabel ? `<tr><td style="padding:6px 0;color:#64748b">Paying by</td><td style="padding:6px 0">${escapeHtml(input.paymentLabel)}</td></tr>` : ""}
      ${input.purchaseTimelineLabel ? `<tr><td style="padding:6px 0;color:#64748b">Timeline</td><td style="padding:6px 0">${escapeHtml(input.purchaseTimelineLabel)}</td></tr>` : ""}
      <tr><td style="padding:6px 0;color:#64748b">Buyer</td><td style="padding:6px 0">${escapeHtml(input.buyerAlias)} <span style="color:#94a3b8">(identity masked until they pick a quote)</span></td></tr>
    </table>
    <p><strong>To reply:</strong> just answer this email with your best out-the-door price — vehicle plus your dealer fees. Leave sales tax and registration out; they're calculated for the buyer's address once they choose. If you'd rather not quote this one, a one-line reply saying so is appreciated.</p>
    <p style="margin:18px 0">
      <a href="${escapeHtml(input.viewUrl)}" style="display:inline-block;background:#059669;color:#fff;text-decoration:none;font-weight:700;padding:10px 18px;border-radius:8px">See the request details</a>
    </p>
    <p style="font-size:12px;color:#64748b;border-top:1px solid #e2e8f0;padding-top:12px;margin-top:20px">${escapeHtml(NON_BINDING_COPY)}</p>
    <p style="font-size:11px;color:#94a3b8">Sent to ${escapeHtml(input.contactName)}, ${escapeHtml(roleLabel)} at ${escapeHtml(input.dealerName)}.${input.dealReference ? ` Reference ${escapeHtml(input.dealReference)}.` : ""}${input.unsubscribeUrl ? ` Don't want quote requests from TrimScout? <a href="${escapeHtml(input.unsubscribeUrl)}" style="color:#64748b">Unsubscribe</a>.` : ""}</p>
  </div>`;
}
