/**
 * The admin's "a request is waiting" email — one per new quote request,
 * with the summary and a link to the approval desk. Pure builder; the
 * sender is lib/dealerEmail.ts (same SAFE MODE routing as dealer mail).
 */
import { DEALER_EMAIL_BASE_URL } from "./dealerUnsubscribe";
import { emailHeader } from "./quoteInviteEmail";
import { rfqDealNumber, rfqQuoteTypeLabel, rfqVehicleSummary } from "./rfqTracker";
import type { RfqRequest } from "./rfq";

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function approvalAlertSubject(rfq: RfqRequest): string {
  return `[Approval needed] ${rfqDealNumber(rfq)} · ${rfqVehicleSummary(rfq)} · ${rfqQuoteTypeLabel(rfq)}`;
}

export function approvalDeskUrl(rfq: Pick<RfqRequest, "id">): string {
  return `${DEALER_EMAIL_BASE_URL}/admin/approvals#rfq-${rfq.id}`;
}

export function approvalAlertHtml(rfq: RfqRequest): string {
  const dealers = (rfq.linkPastes || []).map((p) => (typeof p.dealerName === "string" && p.dealerName.trim()) || "(no dealership attached)");
  const url = escapeHtml(approvalDeskUrl(rfq));
  return `
  <div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:600px;margin:0 auto;color:#0f172a;line-height:1.5">
    ${emailHeader()}
    <p style="font-size:15px;margin:0 0 12px"><strong>A quote request is waiting for approval.</strong> Nothing goes to the dealers until you release it.</p>
    <table style="font-size:13px;border-collapse:collapse">
      <tr><td style="padding:2px 12px 2px 0;color:#64748b">Request</td><td>${escapeHtml(rfqDealNumber(rfq))} (rfq #${escapeHtml(rfq.id)})</td></tr>
      <tr><td style="padding:2px 12px 2px 0;color:#64748b">Vehicle</td><td>${escapeHtml(rfqVehicleSummary(rfq))} · VIN ${escapeHtml(rfq.vin)}</td></tr>
      <tr><td style="padding:2px 12px 2px 0;color:#64748b">Type</td><td>${escapeHtml(rfqQuoteTypeLabel(rfq))}</td></tr>
      <tr><td style="padding:2px 12px 2px 0;color:#64748b">Dealers</td><td>${dealers.length ? escapeHtml(dealers.join(" · ")) : "—"}</td></tr>
      <tr><td style="padding:2px 12px 2px 0;color:#64748b">Buyer</td><td>${escapeHtml(rfq.buyerUserId)}</td></tr>
      ${rfq.buyerNote ? `<tr><td style="padding:2px 12px 2px 0;color:#64748b;vertical-align:top">Note</td><td>${escapeHtml(rfq.buyerNote)}</td></tr>` : ""}
    </table>
    <p style="margin:16px 0"><a href="${url}" style="display:inline-block;background:#10b981;color:#000;font-weight:800;padding:10px 16px;border-radius:10px;text-decoration:none">Open the approval desk</a></p>
    <p style="font-size:11px;color:#64748b">Approve &amp; release, correct the quote sheet first, or reject with a reason the buyer will see.</p>
  </div>`;
}
