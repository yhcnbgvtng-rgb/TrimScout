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
