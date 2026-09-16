/**
 * Client-safe half of the crawl sheet: the row type, the column list and the CSV writer. lib/crawlSheet.ts
 * (server) builds rows from directory data; the admin page imports only this file, so no server module
 * (dealershipsApi → server secrets) lands in the browser bundle.
 */
export type EmailKind = "named" | "generic" | "none";
export type StaffPageStatus = "captured" | "blocked" | "no_staff_page" | "no_website" | "unknown";

export interface CrawlRow {
  id: string;
  dealerName: string;
  brands: string[];
  address: string;
  city: string;
  state: string;
  zip: string;
  phone: string;
  website: string;
  domains: string[];
  contactName: string;
  contactTitle: string;
  contactEmail: string;
  emailKind: EmailKind;
  /** A named person at a personal mailbox who hasn't opted out — the only kind a quote request goes to. */
  contactReady: boolean;
  emailOptOut: boolean;
  /** Crawled inventory for this rooftop (filled client-side from /api/admin/inventory?byDealer=1). */
  inStock?: number | null;
  newCount?: number | null;
  priceDrops?: number | null;
  /** Where the contact came from: a staff-page URL, or a locator/site-harvest label. */
  source: string;
  staffPage: StaffPageStatus;
  leadInbox: string;
  emailSource: "staff_page" | "html_recovery" | "lead_inbox" | "enrichment" | "manual" | "";
  updatedAt: string;
  notes: string;
}

export const CRAWL_SHEET_COLUMNS: Array<{ key: keyof CrawlRow; label: string }> = [
  { key: "dealerName", label: "Dealer" },
  { key: "brands", label: "Brand" },
  { key: "city", label: "City" },
  { key: "state", label: "State" },
  { key: "zip", label: "Zip" },
  { key: "phone", label: "Phone" },
  { key: "website", label: "Website" },
  { key: "contactName", label: "Contact" },
  { key: "contactTitle", label: "Title" },
  { key: "contactEmail", label: "Email" },
  { key: "emailKind", label: "Email kind" },
  { key: "contactReady", label: "Contact ready" },
  { key: "inStock", label: "In stock" },
  { key: "newCount", label: "New" },
  { key: "priceDrops", label: "Price drops" },
  { key: "emailSource", label: "Email source" },
  { key: "staffPage", label: "Staff page" },
  { key: "source", label: "Source" },
  { key: "leadInbox", label: "Lead inbox" },
  { key: "domains", label: "Domains" },
  { key: "address", label: "Address" },
  { key: "emailOptOut", label: "Opted out" },
  { key: "updatedAt", label: "Updated" },
  { key: "notes", label: "Crawl notes" },
];

export function crawlRowCell(row: CrawlRow, key: keyof CrawlRow): string {
  const v = row[key];
  if (Array.isArray(v)) return v.join("; ");
  if (typeof v === "boolean") return v ? "yes" : "";
  if (typeof v === "number") return v ? String(v) : "";
  return String(v ?? "");
}

function csvCell(value: string): string {
  const needsQuote = /[",\r\n]/.test(value) || /^[=+\-@]/.test(value);
  return needsQuote ? `"${value.replace(/"/g, '""')}"` : value;
}

/** CSV of exactly the rows and columns on screen, in the order shown. */
export function crawlRowsToCsv(rows: CrawlRow[], columns: Array<keyof CrawlRow> = CRAWL_SHEET_COLUMNS.map((c) => c.key)): string {
  const labels = columns.map((k) => CRAWL_SHEET_COLUMNS.find((c) => c.key === k)?.label || String(k));
  const lines = [labels, ...rows.map((r) => columns.map((k) => crawlRowCell(r, k)))];
  return lines.map((l) => l.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

export function crawlSheetFilename(now: Date = new Date()): string {
  return `trimscout-crawl-sheet-${now.toISOString().slice(0, 10)}.csv`;
}

// ---- Vehicles (crawled dealer inventory) ----------------------------------------------------------------

export interface VehicleRow {
  vin: string;
  dealerId: string | null;
  dealerName: string;
  dealerCity: string | null;
  dealerState: string | null;
  condition: string | null;
  year: number | null;
  make: string | null;
  model: string | null;
  trim: string | null;
  bodyStyle: string | null;
  exteriorColor: string | null;
  interiorColor: string | null;
  mileage: number | null;
  price: number | null;
  msrp: number | null;
  stockNumber: string | null;
  vdpUrl: string | null;
  imageUrl: string | null;
  source: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  removedAt: string | null;
  windowStickerUrl?: string | null;
  engine?: string | null;
  transmission?: string | null;
  daysOnLot?: number | null;
  oldPrice?: number | null;
  priceDiff?: number | null;
  priceChangeType?: string | null;
  changeType?: string | null;
  priceHistory?: Array<{ date: string; price: number }> | null;
  options?: Array<{ code: string | null; name: string | null; price: number | null; kind: string }> | null;
  optionsTotal?: number | null;
  baseMsrp?: number | null;
  crawlFirstSeen?: string | null;
}

export const VEHICLE_SHEET_COLUMNS: Array<{ key: keyof VehicleRow; label: string }> = [
  { key: "dealerName", label: "Dealer" },
  { key: "dealerState", label: "State" },
  { key: "dealerCity", label: "City" },
  { key: "condition", label: "Condition" },
  { key: "year", label: "Year" },
  { key: "make", label: "Make" },
  { key: "model", label: "Model" },
  { key: "trim", label: "Trim" },
  { key: "vin", label: "VIN" },
  { key: "stockNumber", label: "Stock #" },
  { key: "price", label: "Price" },
  { key: "priceDiff", label: "Price Δ" },
  { key: "msrp", label: "MSRP" },
  { key: "mileage", label: "Miles" },
  { key: "daysOnLot", label: "Days on lot" },
  { key: "changeType", label: "Change" },
  { key: "windowStickerUrl", label: "Window sticker" },
  { key: "exteriorColor", label: "Exterior" },
  { key: "interiorColor", label: "Interior" },
  { key: "bodyStyle", label: "Body" },
  { key: "engine", label: "Engine" },
  { key: "transmission", label: "Transmission" },
  { key: "options", label: "Options" },
  { key: "optionsTotal", label: "Options $" },
  { key: "vdpUrl", label: "Listing" },
  { key: "crawlFirstSeen", label: "On site since" },
  { key: "firstSeenAt", label: "First seen" },
  { key: "lastSeenAt", label: "Last seen" },
  { key: "removedAt", label: "Removed" },
  { key: "source", label: "Parsed from" },
];

export function vehicleRowCell(row: VehicleRow, key: keyof VehicleRow): string {
  const v = row[key];
  if (v == null) return "";
  if ((key === "firstSeenAt" || key === "lastSeenAt" || key === "removedAt" || key === "crawlFirstSeen") && typeof v === "string") return v.slice(0, 10);
  if (key === "options" && Array.isArray(v)) return v.map((o) => (o as { name: string | null }).name || (o as { code: string | null }).code || "").filter(Boolean).join("; ");
  if (key === "priceHistory" && Array.isArray(v)) return v.map((h) => `${(h as { date: string }).date}:${(h as { price: number }).price}`).join("; ");
  if (key === "changeType" && typeof v === "string") return ({ NEW_ARRIVAL: "New arrival", SOLD: "Sold", PRICE_CHANGE: "Price change", UNCHANGED: "" } as Record<string, string>)[v] ?? v;
  return String(v);
}

export function vehicleRowsToCsv(rows: VehicleRow[], columns: Array<keyof VehicleRow> = VEHICLE_SHEET_COLUMNS.map((c) => c.key)): string {
  const labels = columns.map((k) => VEHICLE_SHEET_COLUMNS.find((c) => c.key === k)?.label || String(k));
  const lines = [labels, ...rows.map((r) => columns.map((k) => vehicleRowCell(r, k)))];
  return lines.map((l) => l.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

export function vehicleSheetFilename(now: Date = new Date()): string {
  return `trimscout-vehicles-${now.toISOString().slice(0, 10)}.csv`;
}

// ---- VIN history -------------------------------------------------------------------------------------------

export interface VinDay {
  dealerId: string | null;
  seenOn: string;
  price: number | null;
  mileage: number | null;
}

export interface VinTimelineRow {
  date: string;
  /** "seen" = the crawl observed it that day; "gap" = between observations; "removed" = the day it left the site. */
  status: "seen" | "gap" | "removed";
  price: number | null;
  /** Change versus the previous known price (0 on the first known day). */
  delta: number | null;
  mileage: number | null;
}

const addDays = (iso: string, n: number) => { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

/**
 * Day-by-day history of one listing (a VIN at one store): every calendar day from the first observation (or
 * the crawl's first-seen date) to the last (or its removal day). Days the crawl saw it are "seen" with that day's
 * price; days in between carry the last known price as a "gap"; the removal day closes the run. Price deltas are
 * against the previous known price, so a drop shows on the day it was observed.
 */
export function vinTimeline(listing: Pick<VehicleRow, "dealerId" | "firstSeenAt" | "lastSeenAt" | "removedAt" | "crawlFirstSeen" | "price"> | null, days: VinDay[], today: string = new Date().toISOString().slice(0, 10)): VinTimelineRow[] {
  const mine = days.filter((d) => !listing || (d.dealerId ?? null) === (listing.dealerId ?? null)).sort((a, b) => a.seenOn.localeCompare(b.seenOn));
  const byDay = new Map(mine.map((d) => [d.seenOn, d]));
  const starts = [mine[0]?.seenOn, listing?.crawlFirstSeen?.slice(0, 10), listing?.firstSeenAt?.slice(0, 10)].filter(Boolean) as string[];
  if (!starts.length) return [];
  const start = starts.sort()[0];
  const removed = listing?.removedAt ? listing.removedAt.slice(0, 10) : null;
  const ends = [mine[mine.length - 1]?.seenOn, listing?.lastSeenAt?.slice(0, 10), removed].filter(Boolean) as string[];
  const end = removed ?? (ends.sort().reverse()[0] > today ? today : ends.sort().reverse()[0]);
  const out: VinTimelineRow[] = [];
  let lastPrice: number | null = null;
  for (let d = start; d <= end && out.length < 400; d = addDays(d, 1)) {
    const obs = byDay.get(d);
    if (removed && d === removed && !obs) { out.push({ date: d, status: "removed", price: lastPrice, delta: null, mileage: null }); break; }
    const price = obs?.price ?? (obs ? lastPrice : lastPrice);
    const delta = obs && obs.price != null && lastPrice != null ? obs.price - lastPrice : obs && obs.price != null && lastPrice == null ? 0 : null;
    out.push({ date: d, status: obs ? "seen" : "gap", price, delta, mileage: obs?.mileage ?? null });
    if (obs?.price != null) lastPrice = obs.price;
  }
  return out;
}
