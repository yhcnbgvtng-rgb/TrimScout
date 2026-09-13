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
import { LEASE_NON_BINDING_COPY, type LeaseRequestPrefs } from "./leaseQuote";
import { DEALER_EMAIL_BASE_URL } from "./dealerUnsubscribe";

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
  /**
   * Lease-only flow: the buyer's term / miles / ZIP. When set, the email is
   * the lease template — calculator checklist, the calculator link, and the
   * plain non-binding line — never "reply with a price".
   */
  leasePrefs?: LeaseRequestPrefs | null;
  /** Trim / drivetrain / color as known from the factory record. */
  vehicleFacts?: { drivetrain?: string | null; exteriorColor?: string | null } | null;
}

export const LEASE_CALCULATOR_FIELDS = [
  "Cap cost",
  "Residual % and residual amount",
  "Money factor (we show the APR equivalent)",
  "Term and miles/year — the buyer's, or mark a counter with a short note",
  "Cap reduction",
  "Monthly payment pre-tax (and with estimated tax, if you can)",
  "Due at signing, itemized: first month, acquisition fee, cap reduction, taxes, other fees by name",
  "Incentives and add-ons by name",
  "Quote good-through date",
] as const;

function escapeHtml(s: string): string {
  const map: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  return s.replace(/[&<>"']/g, (c) => map[c]);
}

/** Logo + wordmark at the top of every dealer email; the mark is served from the live site. */
export function emailHeader(): string {
  const home = escapeHtml(DEALER_EMAIL_BASE_URL);
  return `<a href="${home}" style="display:inline-flex;align-items:center;gap:10px;text-decoration:none;margin:0 0 18px"><img src="${home}/scoutmark.png" width="36" height="36" alt="TrimScout" style="display:block;width:36px;height:36px;border-radius:8px;border:0"><span style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;font-size:20px;font-weight:800;letter-spacing:-0.02em;color:#0f172a">Trim<span style="color:#059669">Scout</span></span></a>`;
}

/** Where a desk logs in (opens the sign-in modal) or signs up. Quotes go through the account, never by email reply. */
export function dealerAuthLinks(): { loginUrl: string; signupUrl: string } {
  return { loginUrl: `${DEALER_EMAIL_BASE_URL}/?login=1`, signupUrl: `${DEALER_EMAIL_BASE_URL}/signup` };
}

export function quoteInviteSubject(input: QuoteInviteEmailInput): string {
  const car = [input.vehicle.year, input.vehicle.make, input.vehicle.model, input.vehicle.trim].filter(Boolean).join(" ");
  if (input.leasePrefs) {
    return `Lease quote request: ${car} (VIN …${input.vehicle.vin.slice(-6)}) — ${input.leasePrefs.termMonths} mo / ${input.leasePrefs.milesPerYear.toLocaleString()} mi`;
  }
  return `Quote request: ${car} (VIN …${input.vehicle.vin.slice(-6)}) — ${input.buyerAlias}`;
}

/** The lease template: what's asked, the calculator checklist, the calculator link. Ops can relay it verbatim. */
function leaseInviteHtml(input: QuoteInviteEmailInput, prefs: LeaseRequestPrefs): string {
  const car = [input.vehicle.year, input.vehicle.make, input.vehicle.model, input.vehicle.trim].filter(Boolean).join(" ");
  const roleLabel = (DESK_ROLE_LABELS as Record<string, string>)[input.role] || "Sales";
  const firstName = input.contactName.split(/\s+/)[0] || input.contactName;
  const facts = [input.vehicleFacts?.drivetrain, input.vehicleFacts?.exteriorColor].filter(Boolean).map((x) => escapeHtml(String(x))).join(" · ");
  const timeline = input.purchaseTimelineLabel ? `<tr><td style="padding:6px 0;color:#64748b">Timeline</td><td style="padding:6px 0">${escapeHtml(input.purchaseTimelineLabel)}</td></tr>` : "";
  return `
  <div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:600px;margin:0 auto;color:#0f172a;line-height:1.5">
    ${emailHeader()}
    <p style="font-size:15px">Hi ${escapeHtml(firstName)},</p>
    <p>A buyer on TrimScout is asking for a <strong>lease quote</strong> on a car in your inventory.</p>
    <table style="border-collapse:collapse;width:100%;margin:12px 0;font-size:14px">
      <tr><td style="padding:6px 0;color:#64748b;width:140px">Vehicle</td><td style="padding:6px 0;font-weight:700">${escapeHtml(car)}${facts ? `<br><span style="font-weight:400;color:#475569">${facts}</span>` : ""}</td></tr>
      <tr><td style="padding:6px 0;color:#64748b">VIN</td><td style="padding:6px 0;font-family:ui-monospace,Menlo,monospace">${escapeHtml(input.vehicle.vin)}</td></tr>
      <tr><td style="padding:6px 0;color:#64748b">Term</td><td style="padding:6px 0"><strong>${prefs.termMonths} months</strong></td></tr>
      <tr><td style="padding:6px 0;color:#64748b">Miles / year</td><td style="padding:6px 0"><strong>${prefs.milesPerYear.toLocaleString()}</strong></td></tr>
      ${prefs.zip ? `<tr><td style="padding:6px 0;color:#64748b">Buyer ZIP</td><td style="padding:6px 0">${escapeHtml(prefs.zip)} <span style="color:#94a3b8">(tax context)</span></td></tr>` : ""}
      ${timeline}
    </table>
    <p><strong>To quote:</strong> use the lease calculator at the link below. Every field is required — a monthly-only reply can't be entered:</p>
    <ul style="font-size:14px;margin:8px 0 12px 18px;padding:0">
      ${LEASE_CALCULATOR_FIELDS.map((f) => `<li style="margin:2px 0">${escapeHtml(f)}</li>`).join("")}
    </ul>
    <p style="margin:18px 0">
      <a href="${escapeHtml(input.viewUrl)}" style="display:inline-block;background:#059669;color:#fff;text-decoration:none;font-weight:700;padding:10px 18px;border-radius:8px">Open the lease calculator</a>
    </p>
    <p style="font-size:13px;color:#475569">If the link doesn't work for you, reply with those same fields and TrimScout will enter them for you. If you'd rather not quote this one, a one-line reply saying so lets the buyer move on.</p>
    <p style="font-size:12px;color:#64748b;border-top:1px solid #e2e8f0;padding-top:12px;margin-top:20px">${escapeHtml(LEASE_NON_BINDING_COPY)}</p>
    <p style="font-size:11px;color:#94a3b8">We pass messages between you and the buyer without sharing their email. Sent to ${escapeHtml(input.contactName)}, ${escapeHtml(roleLabel)} at ${escapeHtml(input.dealerName)}.${input.dealReference ? ` Reference ${escapeHtml(input.dealReference)}.` : ""}${input.unsubscribeUrl ? ` Don't want quote requests from TrimScout? <a href="${escapeHtml(input.unsubscribeUrl)}" style="color:#64748b">Unsubscribe</a>.` : ""}</p>
  </div>`;
}

export function quoteInviteHtml(input: QuoteInviteEmailInput): string {
  if (input.leasePrefs) return leaseInviteHtml(input, input.leasePrefs);
  const car = [input.vehicle.year, input.vehicle.make, input.vehicle.model, input.vehicle.trim].filter(Boolean).join(" ");
  const roleLabel = (DESK_ROLE_LABELS as Record<string, string>)[input.role] || "Sales";
  const firstName = input.contactName.split(/\s+/)[0] || input.contactName;
  const listing = input.vehicle.vdpUrl
    ? `<a href="${escapeHtml(input.vehicle.vdpUrl)}" style="color:#059669">your listing</a>`
    : "your listing";
  const auth = dealerAuthLinks();

  return `
  <div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:600px;margin:0 auto;color:#0f172a;line-height:1.5">
    ${emailHeader()}
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
    <p><strong>To quote:</strong> <a href="${escapeHtml(auth.loginUrl)}" style="color:#059669;font-weight:700">log in to TrimScout</a> — or <a href="${escapeHtml(auth.signupUrl)}" style="color:#059669;font-weight:700">sign up</a> if your store doesn't have an account yet. Quotes go through your account, not by replying to this email.</p>
    <p style="margin:18px 0">
      <a href="${escapeHtml(auth.loginUrl)}" style="display:inline-block;background:#059669;color:#fff;text-decoration:none;font-weight:700;padding:10px 18px;border-radius:8px">Log in to quote</a>
      &nbsp;&nbsp;<a href="${escapeHtml(auth.signupUrl)}" style="display:inline-block;border:1px solid #059669;color:#059669;text-decoration:none;font-weight:700;padding:9px 18px;border-radius:8px">Sign up</a>
    </p>
    <p style="font-size:13px;color:#475569"><a href="${escapeHtml(input.viewUrl)}" style="color:#64748b">See the request details</a></p>
    <p style="font-size:12px;color:#64748b;border-top:1px solid #e2e8f0;padding-top:12px;margin-top:20px">${escapeHtml(NON_BINDING_COPY)}</p>
    <p style="font-size:11px;color:#94a3b8">Sent to ${escapeHtml(input.contactName)}, ${escapeHtml(roleLabel)} at ${escapeHtml(input.dealerName)}.${input.dealReference ? ` Reference ${escapeHtml(input.dealReference)}.` : ""}${input.unsubscribeUrl ? ` Don't want quote requests from TrimScout? <a href="${escapeHtml(input.unsubscribeUrl)}" style="color:#64748b">Unsubscribe</a>.` : ""}</p>
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
