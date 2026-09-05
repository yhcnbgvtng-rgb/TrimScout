/**
 * Parses a dealer-contact spreadsheet (.xlsx) into the same rows
 * lib/dealershipCsv.ts produces from CSV — same header-alias matching via
 * rowsFromTable, just fed a table read from a workbook instead of CSV text.
 *
 * Server-only (imports the Node `exceljs` package): a client component
 * uploads the raw file to a route that calls this, rather than parsing the
 * workbook in the browser bundle.
 */

import ExcelJS from "exceljs";
import { rowsFromTable, type DealershipCsvParseResult } from "./dealershipCsv";

function cellToString(value: ExcelJS.CellValue): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") {
    const obj = value as unknown as Record<string, unknown>;
    if (Array.isArray(obj.richText)) {
      return (obj.richText as Array<{ text?: string }>).map((t) => t.text || "").join("");
    }
    if ("result" in obj) return cellToString(obj.result as ExcelJS.CellValue);
    if (typeof obj.text === "string") return obj.text;
  }
  return String(value);
}

export async function parseDealershipXlsxBuffer(buffer: Buffer): Promise<DealershipCsvParseResult> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
  const sheet = workbook.worksheets[0];
  if (!sheet) return { rows: [], skippedRows: 0, unrecognizedColumns: [] };

  const table: string[][] = [];
  sheet.eachRow({ includeEmpty: false }, (row) => {
    const values = row.values as ExcelJS.CellValue[];
    // row.values is 1-indexed — index 0 is unused/undefined.
    table.push(values.slice(1).map(cellToString));
  });
  return rowsFromTable(table);
}
