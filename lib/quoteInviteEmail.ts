/**
 * The one email a desk receives for a quote request. Pure: builds subject +
 * HTML from the invite, the package, and the tracked link. Sending goes
 * through lib/dealerEmail.ts and its SAFE MODE override.
 *
 * One template for Cash, Lease and Finance — CTA first, one card, skinny
 * footer. Only the pay line, the prefs row, the CTA label and the helper
 * line change by quote type. The rooftop (name + location) is always named
 * in the card and the footer so multi-rooftop groups know which store.
 * What it must never do: show the buyer's name, email or phone. The buyer's
 * ZIP appears as the area (tax context) — nothing finer than that.
 */

import { DESK_ROLE_LABELS, type DeskRole } from "./quotePackage";
import type { LeaseRequestPrefs } from "./leaseQuote";
import { DEALER_EMAIL_BASE_URL } from "./dealerUnsubscribe";
import { EXACT_ZIP_LOOKUP } from "./zipCoordinates";
import { getZipCoordinates } from "./otdCalculator";

export type QuoteEmailType = "cash" | "lease" | "finance";

export interface QuoteInviteEmailInput {
  quoteType: QuoteEmailType;
  dealerName: string;
  contactName: string;
  role: DeskRole | string;
  /** Where the store is — from the dealer directory when we have it, else just the state. */
  rooftop?: { city?: string | null; state?: string | null; address?: string | null } | null;
  vehicle: { year: number; make: string; model: string; trim: string; vin: string; vdpUrl: string | null; imageUrl?: string | null };
  dealReference: string | null;
  /** Tracked link — marks the invite viewed, then lands on the quote sheet. */
  viewUrl: string;
  unsubscribeUrl: string | null;
  purchaseTimelineLabel: string | null;
  /** Buyer's ZIP — rendered as an area ("Butler, NJ (07405)"), never an address. */
  buyerZip?: string | null;
  leasePrefs?: LeaseRequestPrefs | null;
  financePrefs?: { termMonths: number; downPayment: number; creditBand?: string | null } | null;
  /** The buyer's note, word for word (already scrubbed of contact info). */
  buyerNote?: string | null;
  /** Kept for callers that still pass it; not rendered. */
  buyerAlias?: string;
  vehicleFacts?: { drivetrain?: string | null; exteriorColor?: string | null } | null;
}

export const QUOTE_EMAIL_COPY: Record<QuoteEmailType, { title: string; pay: string; cta: string; helper: string }> = {
  cash: { title: "OTD quote request", pay: "Cash", cta: "Submit OTD quote", helper: "Include selling price, itemized fees, and a good-until date." },
  lease: { title: "Lease quote request", pay: "Lease", cta: "Submit lease quote", helper: "Include cap cost, MF, residual, itemized due at signing, and a good-until date." },
  finance: { title: "Finance quote request", pay: "Finance", cta: "Submit finance quote", helper: "Include selling price, APR, term, itemized due at signing, and a good-until date." },
};

/** Short legal line for the footer — the full non-binding text lives on the quote sheet. */
export const QUOTE_EMAIL_LEGAL = "Non-binding quote request — not an auction, not a bid, no deadline on you.";

const CREDIT_BAND_LABELS: Record<string, string> = { excellent: "Excellent", good: "Good", fair: "Fair", rebuilding: "Rebuilding" };

function escapeHtml(s: string): string {
  const map: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  return s.replace(/[&<>"']/g, (c) => map[c]);
}

/** "Butler, NJ (07405)" when the ZIP is in the exact table; "NJ (07405)" otherwise; null without a ZIP. */
export function areaLabel(zip: string | null | undefined): string | null {
  const clean = String(zip || "").replace(/\D/g, "").slice(0, 5);
  if (clean.length !== 5) return null;
  const exact = EXACT_ZIP_LOOKUP[clean];
  if (exact) return `${exact.city}, ${exact.state} (${clean})`;
  const approx = getZipCoordinates(clean);
  return approx.state ? `${approx.state} (${clean})` : clean;
}

/** The one-line prefs row by type; null means omit the row (cash without buyer-set notes). */
export function prefsLine(input: Pick<QuoteInviteEmailInput, "quoteType" | "leasePrefs" | "financePrefs">): string | null {
  if (input.quoteType === "lease" && input.leasePrefs) {
    const band = input.leasePrefs.creditBand ? CREDIT_BAND_LABELS[input.leasePrefs.creditBand] : null;
    const upFront = input.leasePrefs.dueAtSigningIntent === "first_month_only" ? "first month + fees up front" : input.leasePrefs.dueAtSigningIntent === "cash_down" ? "money down" : null;
    return [`${input.leasePrefs.termMonths} mo · ${input.leasePrefs.milesPerYear.toLocaleString()} mi/yr`, upFront, band ? `credit: ${band}` : null].filter(Boolean).join(" · ");
  }
  if (input.quoteType === "finance" && input.financePrefs) {
    const band = input.financePrefs.creditBand ? CREDIT_BAND_LABELS[input.financePrefs.creditBand] || input.financePrefs.creditBand : null;
    return `${input.financePrefs.termMonths} mo · $${Math.round(input.financePrefs.downPayment).toLocaleString()} down${band ? ` · credit: ${band}` : ""}`;
  }
  return null;
}

function rooftopLine(input: QuoteInviteEmailInput): string {
  const r = input.rooftop || {};
  const loc = [r.city, r.state].filter(Boolean).join(", ");
  return [input.dealerName, loc, r.address].filter(Boolean).map((x) => escapeHtml(String(x))).join(" · ");
}

/** Logo + wordmark at the top of every dealer email; the mark is served from the live site. */
export function emailHeader(): string {
  const home = escapeHtml(DEALER_EMAIL_BASE_URL);
  return `<a href="${home}" style="display:inline-flex;align-items:center;gap:10px;text-decoration:none;margin:0 0 22px"><img src="${home}/scoutmark.png" width="32" height="32" alt="TrimScout" style="display:block;width:32px;height:32px;border-radius:8px;border:0"><span style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;font-size:19px;font-weight:800;letter-spacing:-0.02em;color:#0f172a"><span style="color:#059669">Trim</span>Scout</span></a>`;
}

/** Where a desk logs in (opens the sign-in modal) or signs up. */
export function dealerAuthLinks(): { loginUrl: string; signupUrl: string } {
  return { loginUrl: `${DEALER_EMAIL_BASE_URL}/?login=1`, signupUrl: `${DEALER_EMAIL_BASE_URL}/signup` };
}

function carName(v: QuoteInviteEmailInput["vehicle"]): string {
  return [v.year, v.make, v.model, v.trim].filter(Boolean).join(" ");
}

export function quoteInviteTitle(input: QuoteInviteEmailInput): string {
  const copy = QUOTE_EMAIL_COPY[input.quoteType];
  const short = [input.vehicle.year, input.vehicle.model, input.vehicle.trim].filter(Boolean).join(" ");
  const area = areaLabel(input.buyerZip ?? input.leasePrefs?.zip);
  return [`${copy.title} — ${short}`, copy.pay, area].filter(Boolean).join(" · ");
}

export function quoteInviteSubject(input: QuoteInviteEmailInput): string {
  return `${quoteInviteTitle(input)} · VIN …${input.vehicle.vin.slice(-6)}`;
}

export function quoteInviteHtml(input: QuoteInviteEmailInput): string {
  const copy = QUOTE_EMAIL_COPY[input.quoteType];
  const roleLabel = (DESK_ROLE_LABELS as Record<string, string>)[input.role] || "Sales";
  const firstName = input.contactName.split(/\s+/)[0] || input.contactName;
  const area = areaLabel(input.buyerZip ?? input.leasePrefs?.zip);
  const prefs = prefsLine(input);
  const view = escapeHtml(input.viewUrl);
  const home = escapeHtml(DEALER_EMAIL_BASE_URL);
  const row = (label: string, value: string) =>
    `<tr><td style="padding:5px 0;color:#64748b;font-size:13px;width:88px;vertical-align:top">${label}</td><td style="padding:5px 0;color:#0f172a;font-size:14px;font-weight:600">${value}</td></tr>`;
  const thumb = input.vehicle.imageUrl
    ? `<td style="width:96px;padding-right:14px;vertical-align:top"><img src="${escapeHtml(input.vehicle.imageUrl)}" width="96" alt="" style="display:block;width:96px;height:auto;border-radius:8px;border:0"></td>`
    : "";
  const facts = [input.vehicleFacts?.drivetrain, input.vehicleFacts?.exteriorColor].filter(Boolean).map((x) => escapeHtml(String(x))).join(" · ");

  return `
  <div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:600px;margin:0 auto;padding:8px 0;color:#0f172a;line-height:1.5">
    ${emailHeader()}
    <h1 style="font-size:20px;line-height:1.3;font-weight:800;letter-spacing:-0.01em;margin:0 0 12px">${escapeHtml(quoteInviteTitle(input))}</h1>
    <p style="font-size:15px;margin:0 0 20px">Hi ${escapeHtml(firstName)} — a buyer wants a <strong>${input.quoteType}</strong> quote on this unit. Submit in TrimScout — don&#39;t reply to this email.</p>
    <p style="margin:0 0 24px">
      <a href="${view}" style="display:inline-block;background:#059669;color:#ffffff;text-decoration:none;font-weight:700;font-size:15px;padding:12px 22px;border-radius:8px">${copy.cta}</a>
    </p>
    <div style="border:1px solid #e2e8f0;border-radius:12px;padding:16px 18px">
      <table role="presentation" style="border-collapse:collapse;width:100%"><tr>${thumb}<td style="vertical-align:top">
        <div style="font-size:16px;font-weight:800">${escapeHtml(carName(input.vehicle))}</div>
        ${facts ? `<div style="font-size:13px;color:#475569">${facts}</div>` : ""}
        <div style="font-size:13px;color:#475569;font-family:ui-monospace,Menlo,monospace;margin-top:2px">VIN ${escapeHtml(input.vehicle.vin)}</div>
        ${input.vehicle.vdpUrl ? `<div style="font-size:13px;margin-top:4px"><a href="${escapeHtml(input.vehicle.vdpUrl)}" style="color:#059669">Your listing</a></div>` : ""}
      </td></tr></table>
      <hr style="border:0;border-top:1px solid #e2e8f0;margin:14px 0">
      <table role="presentation" style="border-collapse:collapse;width:100%">
        ${row("Pay", copy.pay)}
        ${prefs ? row("Prefs", escapeHtml(prefs)) : ""}
        ${area ? row("Area", escapeHtml(area)) : ""}
        ${input.purchaseTimelineLabel ? row("Timeline", escapeHtml(input.purchaseTimelineLabel)) : ""}
        ${row("Rooftop", rooftopLine(input))}
        ${input.buyerNote ? row("Buyer says", `<span style="font-weight:400;white-space:pre-wrap">${escapeHtml(input.buyerNote)}</span>`) : ""}
      </table>
    </div>
    <p style="font-size:13px;color:#475569;margin:14px 0 6px">${escapeHtml(copy.helper)}</p>
    <p style="font-size:13px;margin:0 0 28px"><a href="${view}" style="color:#059669">View request details</a></p>
    <p style="font-size:12px;color:#64748b;border-top:1px solid #e2e8f0;padding-top:12px;margin:0;line-height:1.7">
      Sent to ${escapeHtml(input.contactName)}, ${escapeHtml(roleLabel)} · ${escapeHtml(input.dealerName)}${input.dealReference ? ` · ${escapeHtml(input.dealReference)}` : ""}<br>
      ${input.unsubscribeUrl ? `<a href="${escapeHtml(input.unsubscribeUrl)}" style="color:#64748b">Unsubscribe this rooftop</a><br>` : ""}
      ${escapeHtml(QUOTE_EMAIL_LEGAL)} <a href="${home}/terms" style="color:#64748b">Terms</a>
    </p>
  </div>`;
}

// ---------------------------------------------------------------------------
// Buyer counter → dealer. Same soft-identity rules; the calculator link is
// the only reply path. A request, not a bid.
// ---------------------------------------------------------------------------
export interface BuyerCounterEmailInput {
  dealerName: string;
  contactName: string;
  vehicle: { vin: string; year?: number; make?: string; model?: string; trim?: string; vdpUrl?: string | null };
  dealReference: string | null;
  /** "≤ $650/mo · ≤ $1,500 due at signing · 39 mo" */
  summary: string;
  note: string | null;
  priorMonthly: number;
  viewUrl: string;
}

export function buyerCounterSubject(input: BuyerCounterEmailInput): string {
  const car = [input.vehicle.year, input.vehicle.make, input.vehicle.model, input.vehicle.trim].filter(Boolean).join(" ");
  return `Buyer counter on your lease quote: ${car} (VIN …${input.vehicle.vin.slice(-6)})`;
}

export function buyerCounterHtml(input: BuyerCounterEmailInput): string {
  const car = [input.vehicle.year, input.vehicle.make, input.vehicle.model, input.vehicle.trim].filter(Boolean).join(" ");
  const firstName = input.contactName.split(/\s+/)[0] || input.contactName;
  return `
  <div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:600px;margin:0 auto;color:#0f172a;line-height:1.5">
    ${emailHeader()}
    <p style="font-size:15px">Hi ${escapeHtml(firstName)},</p>
    <p>The buyer looked at your lease quote on the <strong>${escapeHtml(car)}</strong> (VIN ${escapeHtml(input.vehicle.vin)}${input.dealReference ? `, ref ${escapeHtml(input.dealReference)}` : ""}) and sent a counter.</p>
    <table style="border-collapse:collapse;width:100%;margin:12px 0;font-size:14px">
      <tr><td style="padding:6px 0;color:#64748b;width:160px">Your quote</td><td style="padding:6px 0">$${Math.round(input.priorMonthly).toLocaleString()}/mo (pre-tax)</td></tr>
      <tr><td style="padding:6px 0;color:#64748b">Buyer is asking for</td><td style="padding:6px 0"><strong>${escapeHtml(input.summary)}</strong></td></tr>
      ${input.note ? `<tr><td style="padding:6px 0;color:#64748b">Their note</td><td style="padding:6px 0">${escapeHtml(input.note)}</td></tr>` : ""}
    </table>
    <p><strong>To reply:</strong> open the calculator below — it's prefilled with your last quote — and submit a revised lease quote, or mark that you can't do better. This is a request, not a bid, and there's no deadline on you.</p>
    <p style="margin:18px 0"><a href="${escapeHtml(input.viewUrl)}" style="background:#10b981;color:#000;font-weight:700;padding:10px 16px;border-radius:8px;text-decoration:none">Open the calculator</a></p>
    <p style="font-size:12px;color:#64748b">We pass messages between you and the buyer without sharing their email. Replies come back through TrimScout.</p>
  </div>`;
}
