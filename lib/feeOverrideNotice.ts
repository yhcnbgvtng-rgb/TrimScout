/**
 * The one email the buyer gets when a dealer replaces a fee TrimScout calculated (lib/feeOverride.ts). It names every
 * adjusted line with TrimScout's amount, the dealer's amount, the difference and the dealer's reason. Sent through the
 * SAFE MODE sender (lib/dealerEmail.ts), so it lands at the safe recipient whether the request is real, an audit or a
 * test deal. Never contains contact details. A request, not a bid.
 */
import { overrideDifference, OVERRIDE_LABELS, type FeeOverride } from "./feeOverride";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const usd = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
const signed = (n: number) => `${n < 0 ? "−" : "+"}${usd(Math.abs(n))}`;

export interface FeeOverrideNoticeInput {
  dealerName: string;
  vehicle: string;
  overrides: FeeOverride[];
  /** Where the buyer sees the adjusted quote. */
  url: string;
}

export function buildFeeOverrideNotice(i: FeeOverrideNoticeInput): { subject: string; html: string } | null {
  if (!i.overrides.length) return null;
  const headline = "Dealer adjusted a fee on your quote";
  const subject = `[SAFE MODE] ${headline}: ${i.vehicle}`;
  const rows = i.overrides
    .map((o) => {
      const d = overrideDifference(o);
      return `<tr>
        <td style="padding:6px 8px;border-top:1px solid #e5e7eb;"><strong>${esc(OVERRIDE_LABELS[o.key])}</strong><br/><span style="color:#64748b;">${esc(o.reason)}</span></td>
        <td style="padding:6px 8px;border-top:1px solid #e5e7eb;text-align:right;">${usd(o.calculated)}</td>
        <td style="padding:6px 8px;border-top:1px solid #e5e7eb;text-align:right;"><strong>${usd(o.amount)}</strong></td>
        <td style="padding:6px 8px;border-top:1px solid #e5e7eb;text-align:right;">${signed(d)}</td>
      </tr>`;
    })
    .join("");
  const html = `<div style="font-family:system-ui,-apple-system,sans-serif;max-width:560px;color:#111;">
    <p style="font-size:12px;color:#a16207;background:#fef9c3;border-radius:8px;padding:8px 10px;">
      <strong>SAFE MODE:</strong> this buyer notification was redirected here for approval instead of the buyer, per site-owner override.
    </p>
    <h1 style="font-size:18px;margin:16px 0 8px;">${esc(headline)}</h1>
    <p style="font-size:14px;line-height:1.6;color:#374151;">${esc(i.dealerName)} replaced ${i.overrides.length === 1 ? "an amount" : "amounts"} TrimScout calculated, and gave a reason. The doc fee is not part of this; it stays as quoted.</p>
    <table style="width:100%;border-collapse:collapse;font-size:13px;">
      <tr style="color:#64748b;text-align:right;"><th style="padding:4px 8px;text-align:left;">Line</th><th style="padding:4px 8px;">TrimScout</th><th style="padding:4px 8px;">Dealer</th><th style="padding:4px 8px;">Difference</th></tr>
      ${rows}
    </table>
    <p style="font-size:12px;color:#64748b;">${esc(i.vehicle)}. A request, not a bid: nothing here binds either side.</p>
    <a href="${esc(i.url)}" style="display:inline-block;margin-top:12px;padding:10px 18px;border-radius:10px;background:#22c55e;color:#000;font-weight:800;text-decoration:none;">See the adjusted quote</a>
  </div>`.trim();
  return { subject, html };
}
