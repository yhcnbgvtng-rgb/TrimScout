/**
 * What My Deal Tracker shows for a quote-request package (the v1 lease
 * loop), and what the deal's Lease quote sheet reads. Pure: the tracker
 * card, the detail page and the tests all derive from these, so a deal can't
 * say "Awaiting quotes" on one screen and "Quotes in" on another.
 */
import { LEASE_DAS_INTENT_LABELS, type LeaseRequestPrefs } from "./leaseQuote";
import { CREDIT_BAND_LABELS } from "./creditBand";
import type { RfqRequest } from "./rfq";
import { alternateAskSummary } from "./alternateAsk";

/** One pasted car as the package recorded it (rfq.linkPastes rows). */
export interface RfqPasteVehicle {
  vin: string;
  year: number | null;
  make: string;
  model: string;
  trim: string;
  dealerName: string | null;
  dealerState: string | null;
  vdpUrl: string | null;
  factoryVerified: boolean;
  condition: "new" | "used" | "cpo";
  mileage: number | null;
  stockNumber: string | null;
  msrp: number | null;
}

export function rfqVehicles(rfq: Pick<RfqRequest, "linkPastes" | "vin" | "vehicleYear" | "vehicleMake" | "vehicleModel" | "vehicleTrim">): RfqPasteVehicle[] {
  const rows = Array.isArray(rfq.linkPastes) ? rfq.linkPastes : [];
  const fromPastes = rows
    .map((p): RfqPasteVehicle | null => {
      const vin = typeof p.vin === "string" ? p.vin.trim().toUpperCase() : "";
      if (!vin) return null;
      // A paste row that recorded only the VIN (older packages) still names
      // the car when it is the package's primary vehicle.
      const isSpec = vin === (rfq.vin || "").trim().toUpperCase();
      return {
        vin,
        year: typeof p.year === "number" ? p.year : Number(p.year) || (isSpec ? rfq.vehicleYear || null : null),
        make: typeof p.make === "string" && p.make ? p.make : isSpec ? rfq.vehicleMake : "",
        model: typeof p.model === "string" && p.model ? p.model : isSpec ? rfq.vehicleModel : "",
        trim: typeof p.trim === "string" && p.trim ? p.trim : isSpec ? rfq.vehicleTrim : "",
        dealerName: typeof p.dealerName === "string" && p.dealerName.trim() ? p.dealerName.trim() : null,
        dealerState: typeof p.dealerState === "string" && p.dealerState.trim() ? p.dealerState.trim().toUpperCase() : null,
        vdpUrl: typeof p.vdpUrl === "string" && p.vdpUrl ? p.vdpUrl : null,
        factoryVerified: p.buildConfidence === "verified_factory",
        condition: p.condition === "used" || p.condition === "cpo" ? p.condition : "new",
        mileage: typeof p.mileage === "number" && Number.isFinite(p.mileage) ? p.mileage : null,
        stockNumber: typeof p.stockNumber === "string" && p.stockNumber ? p.stockNumber : null,
        msrp: typeof p.msrp === "number" && Number.isFinite(p.msrp) && p.msrp > 0 ? p.msrp : null,
      };
    })
    .filter((v): v is RfqPasteVehicle => v !== null);
  if (fromPastes.length) return fromPastes;
  // A "match" package or an old row: the spec fields are all we have.
  return [
    {
      vin: rfq.vin,
      year: rfq.vehicleYear || null,
      make: rfq.vehicleMake,
      model: rfq.vehicleModel,
      trim: rfq.vehicleTrim,
      dealerName: null,
      dealerState: null,
      vdpUrl: null,
      factoryVerified: false,
      condition: "new",
      mileage: null,
      stockNumber: null,
      msrp: null,
    },
  ];
}

export function vehicleLine(v: Pick<RfqPasteVehicle, "year" | "make" | "model" | "trim">): string {
  return [v.year, v.make, v.model, v.trim].filter(Boolean).join(" ");
}

/** "2026 Chevrolet Tahoe LS", "2026 Chevrolet Tahoe LS + 2 more", or on the alternate lane the ask. */
export function rfqVehicleSummary(rfq: Parameters<typeof rfqVehicles>[0] & Partial<Pick<RfqRequest, "lane" | "alternateAsk">>): string {
  if ((rfq.lane ?? "same_spec") === "alternate") return `Open to different vehicles — ${alternateAskSummary(rfq.alternateAsk)}`;
  const vs = rfqVehicles(rfq);
  const first = vehicleLine(vs[0]);
  return vs.length > 1 ? `${first} + ${vs.length - 1} more` : first;
}

/**
 * The one lifecycle strip at the top of every Deal Tracker card:
 * Draft → In progress → Sent, awaiting dealer response → Walked away | Successful.
 * "Draft" is a saved, unsent wizard draft (no request on the box yet);
 * "In progress" is a request whose invites are still going out.
 */
export type RfqLifecycleStage = "draft" | "in_progress" | "under_review" | "awaiting" | "walked" | "successful";
export const RFQ_LIFECYCLE: ReadonlyArray<{ id: RfqLifecycleStage; label: string }> = [
  { id: "draft", label: "Draft" },
  { id: "in_progress", label: "In progress" },
  { id: "under_review", label: "Under review" },
  { id: "awaiting", label: "Sent — awaiting dealer response" },
  { id: "walked", label: "Walked away" },
  { id: "successful", label: "Successful" },
];

/** The buyer-facing promise while an admin checks the request. */
export const UNDER_REVIEW_COPY = "Under review — released to dealers within 1 business day.";

type LifecycleRfq = Pick<RfqRequest, "status" | "invites"> & Partial<Pick<RfqRequest, "approvalStatus" | "rejectionReason" | "adminEdits">>;

/** True while the request waits on (or was refused by) the admin gate; pre-gate rows read as released. */
export function rfqAwaitingApproval(rfq: Pick<RfqRequest, "approvalStatus">): boolean {
  return (rfq.approvalStatus ?? "approved") !== "approved";
}

export function rfqLifecycleStage(rfq: LifecycleRfq): RfqLifecycleStage {
  if (rfq.status === "picked") return "successful";
  if (rfq.status === "walked") return "walked";
  const open = rfq.invites.filter((i) => i.status !== "declined" && i.status !== "expired");
  if (open.length === 0) return "in_progress";
  // The admin gate sits between "dealers chosen" and "sent": a submitted
  // request (queued invites) that hasn't been released is under review —
  // including a rejected one, which stays here with its reason until the
  // buyer fixes and resubmits.
  if (rfqAwaitingApproval(rfq)) return "under_review";
  if (open.some((i) => i.status === "invited" && (i.deliveryStatus ?? "queued") === "queued")) return "in_progress";
  return "awaiting";
}

/** One line under the strip: what's actually happening at this stage. */
export function rfqLifecycleDetail(rfq: LifecycleRfq): string {
  const quotes = rfq.invites.filter((i) => i.quote).length;
  const sent = rfq.invites.filter((i) => i.status !== "declined" && i.status !== "expired" && !(i.dealerUnsubscribedAt && !i.quote)).length;
  switch (rfqLifecycleStage(rfq)) {
    case "draft":
      return "Not sent yet — pick up where you left off.";
    case "in_progress":
      return sent === 0 ? "No dealer is on this request yet." : `Sending to ${sent} dealer${sent === 1 ? "" : "s"}…`;
    case "under_review":
      return rfq.approvalStatus === "rejected"
        ? `Not released — ${rfq.rejectionReason || "TrimScout couldn't send this as submitted"}. Fix it and resubmit.`
        : UNDER_REVIEW_COPY;
    case "awaiting":
      return quotes === 0
        ? `${sent} dealer${sent === 1 ? "" : "s"} have it — none has replied yet. They answer on their own time.`
        : `${quotes} of ${sent} dealer${sent === 1 ? "" : "s"} replied — compare and pick one, or walk away.`;
    case "walked":
      return "You walked away from this request.";
    case "successful":
      return "You chose a quote — the dealer has your pick.";
  }
}

export type RfqTrackerStatus = "under_review" | "rejected" | "awaiting" | "quotes_in" | "closed_picked" | "closed_walked";

export function rfqTrackerStatus(rfq: LifecycleRfq): RfqTrackerStatus {
  if (rfq.status === "picked") return "closed_picked";
  if (rfq.status === "walked") return "closed_walked";
  if (rfqAwaitingApproval(rfq)) return rfq.approvalStatus === "rejected" ? "rejected" : "under_review";
  return rfq.invites.some((i) => i.quote) ? "quotes_in" : "awaiting";
}

export function rfqTrackerStatusLabel(rfq: LifecycleRfq): string {
  const n = rfq.invites.filter((i) => i.quote).length;
  switch (rfqTrackerStatus(rfq)) {
    case "under_review":
      return "Under review";
    case "rejected":
      return "Not released";
    case "awaiting":
      return "Awaiting quotes";
    case "quotes_in":
      return `${n} quote${n === 1 ? "" : "s"} in`;
    case "closed_picked":
      return "Closed — quote chosen";
    case "closed_walked":
      return "Closed — walked away";
  }
}

export function rfqQuoteTypeLabel(rfq: Pick<RfqRequest, "leasePrefs" | "quotePrefs">): "Lease" | "Finance" | "Cash" | "Quote" {
  if (rfq.leasePrefs) return "Lease";
  if (rfq.quotePrefs?.quoteType === "finance") return "Finance";
  if (rfq.quotePrefs?.quoteType === "cash") return "Cash";
  return "Quote";
}

/** "TS-K7M3Q2", falling back to the row id so support can always find it. */
export function rfqDealNumber(rfq: Pick<RfqRequest, "dealReference" | "id">): string {
  return rfq.dealReference?.trim() || `#${rfq.id}`;
}

export const LEASE_TIMELINE_LABELS: Record<NonNullable<LeaseRequestPrefs["timeline"]>, string> = {
  asap: "ASAP",
  this_week: "Within the week",
  this_month: "Within the month",
};

/** The fixed line every lease sheet carries — the format dealers quote against. */
export const LEASE_SHEET_RULES = "Dealers reply through the lease calculator — or mark a counter. Request, not a binding bid.";

/** The lease sheet's preference rows, in display order. Absent optional prefs are left out, never shown as "—". */
export function leaseSheetRows(prefs: LeaseRequestPrefs): Array<{ label: string; value: string }> {
  const rows = [
    { label: "Term", value: `${prefs.termMonths} months` },
    { label: "Miles / year", value: prefs.milesPerYear.toLocaleString() },
  ];
  if (prefs.dueAtSigningIntent) rows.push({ label: "Due at signing", value: LEASE_DAS_INTENT_LABELS[prefs.dueAtSigningIntent] });
  if (prefs.creditBand) rows.push({ label: "Credit band", value: CREDIT_BAND_LABELS[prefs.creditBand] });
  if (prefs.zip) rows.push({ label: "ZIP", value: `${prefs.zip} (tax context)` });
  if (prefs.timeline) rows.push({ label: "Timeline", value: LEASE_TIMELINE_LABELS[prefs.timeline] });
  return rows;
}

/** "3 min ago" / "2 h ago" / "Yesterday" / a date — for the tracker card. */
export function relativeTime(iso: string, now: number = Date.now()): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "";
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return "Just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  if (d === 1) return "Yesterday";
  if (d < 7) return `${d} days ago`;
  return new Date(t).toLocaleDateString();
}
