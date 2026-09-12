/**
 * Parses a dealer-contact spreadsheet (CSV) into dealership_contacts rows.
 * Not tied to any one manufacturer's crawl — matches header names loosely
 * (aliases below) so a Ford GM-contact export, a GM one, a Honda one, etc.
 * all map onto the same fields without code changes per brand.
 */

export interface ParsedDealershipRow {
  dealerName: string;
  address?: string;
  city?: string;
  state?: string;
  zipCode?: string;
  phone?: string;
  contactName?: string;
  contactEmail?: string;
  notes?: string;
  website?: string;
  /** Split on ; | or whitespace in the sheet; normalized downstream. */
  domains?: string[];
}

export interface DealershipCsvParseResult {
  rows: ParsedDealershipRow[];
  /** Rows with no recognizable dealer name — dropped, but counted so the UI can flag it. */
  skippedRows: number;
  /** Column headers present in the file that didn't match any known field. */
  unrecognizedColumns: string[];
}

const HEADER_ALIASES: Record<Exclude<keyof ParsedDealershipRow, "domains"> | "domains", string[]> = {
  dealerName: ["dealer name", "dealername", "dealer", "name", "rooftop", "dealership"],
  address: ["address", "street", "street address"],
  city: ["city"],
  state: ["state", "st"],
  zipCode: ["zip", "zip code", "zipcode", "postal code"],
  phone: ["phone", "phone number", "dealer phone"],
  contactName: ["gm name", "general manager", "gm", "manager name", "manager", "contact name", "contact"],
  contactEmail: ["gm email", "manager email", "contact email", "email"],
  notes: ["notes", "note", "comments", "comment"],
  website: ["website", "web site", "url", "site", "dealer website", "dealer url"],
  domains: ["domains", "domain", "domain aliases", "hosts", "host aliases"],
};

function normalizeHeader(h: string): string {
  return h.trim().toLowerCase().replace(/\s+/g, " ");
}

/** RFC4180-ish: handles quoted fields, embedded commas/quotes/newlines. */
export function parseCsvTable(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let sawAnyField = false;
  const n = text.length;
  for (let i = 0; i < n; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
      continue;
    }
    if (c === '"') {
      inQuotes = true;
      sawAnyField = true;
      continue;
    }
    if (c === ",") {
      row.push(field);
      field = "";
      sawAnyField = true;
      continue;
    }
    if (c === "\r") continue;
    if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      sawAnyField = false;
      continue;
    }
    field += c;
    sawAnyField = true;
  }
  if (sawAnyField || field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => !(r.length === 1 && r[0].trim() === ""));
}

export function parseDealershipCsv(text: string): DealershipCsvParseResult {
  return rowsFromTable(parseCsvTable(text));
}

/**
 * Same header-alias mapping as parseDealershipCsv, but for a table already
 * split into cells — shared with lib/dealershipXlsx.ts, which reads an
 * .xlsx sheet into the same string[][] shape instead of parsing CSV text.
 */
export function rowsFromTable(table: string[][]): DealershipCsvParseResult {
  if (table.length === 0) return { rows: [], skippedRows: 0, unrecognizedColumns: [] };

  const headerRow = table[0].map(normalizeHeader);
  const fieldForColumn: Array<keyof ParsedDealershipRow | null> = headerRow.map((h) => {
    for (const key of Object.keys(HEADER_ALIASES) as Array<keyof ParsedDealershipRow>) {
      if (HEADER_ALIASES[key].includes(h)) return key;
    }
    return null;
  });
  const unrecognizedColumns = Array.from(
    new Set(headerRow.filter((h, i) => fieldForColumn[i] == null && h.length > 0))
  );

  const rows: ParsedDealershipRow[] = [];
  let skippedRows = 0;
  for (let r = 1; r < table.length; r++) {
    const cells = table[r];
    if (cells.every((c) => !c.trim())) continue;
    const record: Partial<ParsedDealershipRow> = {};
    cells.forEach((cell, i) => {
      const field = fieldForColumn[i];
      if (!field) return;
      const value = cell.trim();
      if (!value) return;
      if (field === "domains") {
        record.domains = value.split(/[;|,\s]+/).map((d) => d.trim().toLowerCase()).filter(Boolean);
      } else {
        record[field] = value;
      }
    });
    if (!record.dealerName) {
      skippedRows++;
      continue;
    }
    rows.push(record as ParsedDealershipRow);
  }

  return { rows, skippedRows, unrecognizedColumns };
}

// ---------------------------------------------------------------------------
// Export — the inverse of the parser above. Headers are chosen so the file
// re-uploads cleanly: every data column is a recognized alias, and the two
// read-only columns (opt-out, updated) land in unrecognizedColumns rather
// than silently overwriting anything. Opt-out in particular must never be
// settable from a spreadsheet — it only moves via the unsubscribe link.
// ---------------------------------------------------------------------------

export interface ExportableDealership {
  dealerName: string;
  address: string | null;
  city: string | null;
  state: string | null;
  zipCode: string | null;
  phone: string | null;
  contactName: string | null;
  contactEmail: string | null;
  notes: string | null;
  website?: string | null;
  domains?: string[] | null;
  emailOptOut: boolean;
  updatedAt: string;
}

export const DEALERSHIP_EXPORT_HEADERS = [
  "Dealer Name",
  "Address",
  "City",
  "State",
  "Zip",
  "Phone",
  "Contact Name",
  "Contact Email",
  "Website",
  "Domains",
  "Notes",
  "Email Opt-Out",
  "Updated",
] as const;

/** Header row + one row per dealership, as strings — shared by the CSV and xlsx writers. */
export function dealershipsToTable(dealerships: ExportableDealership[]): string[][] {
  const rows = dealerships.map((d) => [
    d.dealerName || "",
    d.address || "",
    d.city || "",
    d.state || "",
    d.zipCode || "",
    d.phone || "",
    d.contactName || "",
    d.contactEmail || "",
    d.website || "",
    (d.domains || []).join("; "),
    d.notes || "",
    d.emailOptOut ? "yes" : "",
    d.updatedAt || "",
  ]);
  return [[...DEALERSHIP_EXPORT_HEADERS], ...rows];
}

function csvCell(value: string): string {
  // RFC4180: quote when the cell holds a comma, quote, or line break; double
  // embedded quotes. Also quote leading =/+/-/@ so a spreadsheet app doesn't
  // treat a pasted note as a formula.
  const needsQuote = /[",\r\n]/.test(value) || /^[=+\-@]/.test(value);
  return needsQuote ? `"${value.replace(/"/g, '""')}"` : value;
}

export function tableToCsv(table: string[][]): string {
  return table.map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

export function dealershipsToCsv(dealerships: ExportableDealership[]): string {
  return tableToCsv(dealershipsToTable(dealerships));
}

/** `trimscout-dealership-contacts-2026-09-12.csv` — dated so re-downloads don't clobber each other. */
export function dealershipExportFilename(format: "csv" | "xlsx", now: Date = new Date()): string {
  return `trimscout-dealership-contacts-${now.toISOString().slice(0, 10)}.${format}`;
}
