/**
 * What My Deal Tracker shows for a quote-request package (the v1 lease
 * loop), and what the deal's Lease quote sheet reads. Pure: the tracker
 * card, the detail page and the tests all derive from these, so a deal can't
 * say "Awaiting quotes" on one screen and "Quotes in" on another.
 */
import type { LeaseRequestPrefs } from "./leaseQuote";
import type { RfqRequest } from "./rfq";
import { parseMustConfirmList, type MustConfirmItem } from "./mustConfirm";

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
  mustConfirm: MustConfirmItem[];
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
        mustConfirm: parseMustConfirmList(p.mustConfirm),
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
      mustConfirm: [],
    },
  ];
}

export function vehicleLine(v: Pick<RfqPasteVehicle, "year" | "make" | "model" | "trim">): string {
  return [v.year, v.make, v.model, v.trim].filter(Boolean).join(" ");
}

/** "2026 Chevrolet Tahoe LS" or "2026 Chevrolet Tahoe LS + 2 more". */
export function rfqVehicleSummary(rfq: Parameters<typeof rfqVehicles>[0]): string {
  const vs = rfqVehicles(rfq);
  const first = vehicleLine(vs[0]);
  return vs.length > 1 ? `${first} + ${vs.length - 1} more` : first;
}

export type RfqTrackerStatus = "awaiting" | "quotes_in" | "closed_picked" | "closed_walked";

export function rfqTrackerStatus(rfq: Pick<RfqRequest, "status" | "invites">): RfqTrackerStatus {
  if (rfq.status === "picked") return "closed_picked";
  if (rfq.status === "walked") return "closed_walked";
  return rfq.invites.some((i) => i.quote) ? "quotes_in" : "awaiting";
}

export function rfqTrackerStatusLabel(rfq: Pick<RfqRequest, "status" | "invites">): string {
  const n = rfq.invites.filter((i) => i.quote).length;
  switch (rfqTrackerStatus(rfq)) {
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
