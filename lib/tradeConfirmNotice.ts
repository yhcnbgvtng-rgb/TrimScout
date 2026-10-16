/**
 * The emails around the trade confirm step. Both go through the SAFE MODE sender (lib/dealerEmail.ts), so they land at the safe
 * recipient whether the request is real, an audit or a test deal. Each only LINKS into TrimScout: there is no reply path, no
 * contact details of either side, and the copy says so. A request, not a bid.
 *   - to the dealer: you were selected, confirm or revise your trade value by <deadline>
 *   - to the buyer: the dealer revised the trade value (before, after, reason, new post-trade OTD)
 */
import { REVISION_REASONS, type TradeConfirmation } from "./trade/confirm";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const usd = (n: number) => `${n < 0 ? "-" : ""}$${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
const when = (iso: string) => new Date(iso).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "America/New_York" }) + " ET";

const shell = (headline: string, bodyHtml: string, cta: string, url: string) => `<div style="font-family:system-ui,-apple-system,sans-serif;max-width:560px;color:#111;">
    <p style="font-size:12px;color:#a16207;background:#fef9c3;border-radius:8px;padding:8px 10px;">
      <strong>SAFE MODE:</strong> this notification was redirected here for approval instead of the real recipient, per site-owner override.
    </p>
    <h1 style="font-size:18px;margin:16px 0 8px;">${esc(headline)}</h1>
    ${bodyHtml}
    <a href="${esc(url)}" style="display:inline-block;margin-top:12px;padding:10px 18px;border-radius:10px;background:#22c55e;color:#000;font-weight:800;text-decoration:none;">${esc(cta)}</a>
    <p style="font-size:12px;color:#64748b;margin-top:16px;">Please don't reply to this email: it isn't read. Do this inside TrimScout with the button above. A request, not a bid: nothing here binds either side.</p>
  </div>`.trim();

export interface ConfirmRequestedInput { dealerName: string; vehicle: string; tradeTitle: string; confirmation: TradeConfirmation; url: string }

export function buildConfirmRequestedNotice(i: ConfirmRequestedInput): { subject: string; html: string } {
  const c = i.confirmation;
  const range = c.range ? ` (you quoted ${usd(c.range.low)} to ${usd(c.range.high)}; you'll confirm one number)` : "";
  const headline = "The buyer selected your quote: confirm the trade value";
  const html = shell(
    headline,
    `<p style="font-size:14px;line-height:1.6;color:#374151;">The buyer chose ${esc(i.dealerName)} for the ${esc(i.vehicle)}. Please confirm or revise your trade allowance for their ${esc(i.tradeTitle)} in TrimScout by <strong>${esc(when(c.deadlineAt))}</strong>.</p>
    <p style="font-size:14px;line-height:1.6;color:#374151;">You quoted <strong>${usd(c.allowancePrelim)}</strong>${esc(range)}, ${c.basis === "firm" ? "Firm" : "Preliminary"}. One click confirms it. If you revise it, a reason is required and the buyer decides whether to accept. If nothing is done by the deadline, your original number stands.</p>`,
    "Confirm or revise the trade value", i.url,
  );
  return { subject: `[SAFE MODE] ${headline}: ${i.vehicle}`, html };
}

export interface RevisedInput { dealerName: string; vehicle: string; confirmation: TradeConfirmation; postTradeOtd: number | null; url: string }

export function buildRevisedNotice(i: RevisedInput): { subject: string; html: string } {
  const c = i.confirmation;
  const reason = c.revisionReasonCode ? REVISION_REASONS[c.revisionReasonCode] : "";
  const headline = "The dealer revised your trade value";
  const html = shell(
    headline,
    `<p style="font-size:14px;line-height:1.6;color:#374151;">${esc(i.dealerName)} changed the trade allowance for your ${esc(i.vehicle)} deal after you selected them.</p>
    <table style="width:100%;border-collapse:collapse;font-size:13px;">
      <tr><td style="padding:6px 8px;border-top:1px solid #e5e7eb;">Quoted</td><td style="padding:6px 8px;border-top:1px solid #e5e7eb;text-align:right;">${usd(c.allowancePrelim)}</td></tr>
      <tr><td style="padding:6px 8px;border-top:1px solid #e5e7eb;"><strong>Revised</strong></td><td style="padding:6px 8px;border-top:1px solid #e5e7eb;text-align:right;"><strong>${usd(c.allowanceFinal ?? c.allowancePrelim)}</strong></td></tr>
      ${i.postTradeOtd != null ? `<tr><td style="padding:6px 8px;border-top:1px solid #e5e7eb;">New out-the-door after trade</td><td style="padding:6px 8px;border-top:1px solid #e5e7eb;text-align:right;">${usd(i.postTradeOtd)}</td></tr>` : ""}
      <tr><td style="padding:6px 8px;border-top:1px solid #e5e7eb;vertical-align:top;">Reason</td><td style="padding:6px 8px;border-top:1px solid #e5e7eb;text-align:right;">${esc(reason)}${c.revisionReasonText ? `<br/><span style="color:#64748b;">${esc(c.revisionReasonText)}</span>` : ""}</td></tr>
    </table>
    <p style="font-size:14px;line-height:1.6;color:#374151;">You can accept the revised number, or go back and pick another quote. The other dealers' numbers are exactly as they were. You can also walk away.</p>`,
    "Review the revised number", i.url,
  );
  return { subject: `[SAFE MODE] ${headline}: ${i.vehicle}`, html };
}
