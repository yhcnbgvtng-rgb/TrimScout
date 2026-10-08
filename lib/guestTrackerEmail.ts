/**
 * The deal-tracker link for a guest (REQUIRE_BUYER_LOGIN=false) request. Sent through the SAFE MODE
 * sender — see lib/dealerEmail.ts — so it lands with the site owner until that override is lifted;
 * the guest also gets the same link on screen the moment they send.
 */
import type { RfqRequest } from "./rfq";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export const guestTrackerEmailSubject = (rfq: Pick<RfqRequest, "vehicleYear" | "vehicleMake" | "vehicleModel">): string =>
  `[SAFE MODE] Guest deal tracker link — ${rfq.vehicleYear} ${rfq.vehicleMake} ${rfq.vehicleModel}`;

export function guestTrackerEmailHtml(rfq: Pick<RfqRequest, "vehicleYear" | "vehicleMake" | "vehicleModel" | "vehicleTrim">, guestEmail: string, trackerUrl: string): string {
  return `<div style="font-family:system-ui,-apple-system,sans-serif;max-width:520px;color:#111;">
    <p style="font-size:12px;color:#a16207;background:#fef9c3;border-radius:8px;padding:8px 10px;">
      <strong>SAFE MODE:</strong> this was addressed to <strong>${esc(guestEmail)}</strong> but redirected here per site-owner override.
    </p>
    <h1 style="font-size:18px;margin:16px 0 8px;">Your TrimScout deal tracker</h1>
    <p style="font-size:14px;line-height:1.6;color:#374151;">Your quote request for the ${esc(`${rfq.vehicleYear} ${rfq.vehicleMake} ${rfq.vehicleModel} ${rfq.vehicleTrim}`.trim())} is under review. Use this private link to follow replies, compare quotes and pick one. Anyone with the link can open it, so keep it to yourself.</p>
    <a href="${esc(trackerUrl)}" style="display:inline-block;margin-top:12px;padding:10px 18px;border-radius:10px;background:#22c55e;color:#000;font-weight:800;text-decoration:none;">Open my deal tracker</a>
  </div>`.trim();
}
