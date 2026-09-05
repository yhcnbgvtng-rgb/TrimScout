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
}

export interface DealershipCsvParseResult {
  rows: ParsedDealershipRow[];
  /** Rows with no recognizable dealer name — dropped, but counted so the UI can flag it. */
  skippedRows: number;
  /** Column headers present in the file that didn't match any known field. */
  unrecognizedColumns: string[];
}

const HEADER_ALIASES: Record<keyof ParsedDealershipRow, string[]> = {
  dealerName: ["dealer name", "dealername", "dealer", "name", "rooftop", "dealership"],
  address: ["address", "street", "street address"],
  city: ["city"],
  state: ["state", "st"],
  zipCode: ["zip", "zip code", "zipcode", "postal code"],
  phone: ["phone", "phone number", "dealer phone"],
  contactName: ["gm name", "general manager", "gm", "manager name", "manager", "contact name", "contact"],
  contactEmail: ["gm email", "manager email", "contact email", "email"],
  notes: ["notes", "note", "comments", "comment"],
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
      if (value) record[field] = value;
    });
    if (!record.dealerName) {
      skippedRows++;
      continue;
    }
    rows.push(record as ParsedDealershipRow);
  }

  return { rows, skippedRows, unrecognizedColumns };
}
