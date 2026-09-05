import assert from "node:assert/strict";
import { describe, it } from "node:test";
import ExcelJS from "exceljs";
import { parseDealershipXlsxBuffer } from "./dealershipXlsx";

async function buildWorkbookBuffer(rows: string[][]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Dealers");
  rows.forEach((row) => sheet.addRow(row));
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

describe("parseDealershipXlsxBuffer", () => {
  it("reads the real Ford dealer-crawl export header shape, same field mapping as CSV", async () => {
    // Exact header row from the real Ford_Dealer_Contacts_*.xlsx exports —
    // Website/Contact Title/Contact Source URL have no field mapping and
    // should land in unrecognizedColumns, same as an unmapped CSV column.
    const buffer = await buildWorkbookBuffer([
      ["Dealer Name", "Address", "City", "State", "ZIP", "Phone", "Website", "Contact Name", "Contact Title", "Contact Email", "Contact Source URL", "Notes"],
      [
        "Aaron Ford of Escondido",
        "1717 Auto Park Way South",
        "Escondido",
        "CA",
        "92029",
        "(442) 777-4059",
        "https://www.aaronfordofescondido.org",
        "",
        "",
        "",
        "",
        "unreachable - 403 Forbidden after 2 attempts",
      ],
      [
        "Battlefield Ford",
        "123 Main St",
        "Culpeper",
        "VA",
        "22701",
        "(540) 555-0100",
        "https://www.battlefieldford.com",
        "Jane Doe",
        "General Sales Manager",
        "jane@battlefieldford.com",
        "https://www.battlefieldford.com/staff",
        "",
      ],
    ]);

    const parsed = await parseDealershipXlsxBuffer(buffer);
    assert.equal(parsed.rows.length, 2);
    assert.equal(parsed.rows[0].dealerName, "Aaron Ford of Escondido");
    assert.equal(parsed.rows[0].zipCode, "92029");
    assert.equal(parsed.rows[0].contactEmail, undefined);
    assert.equal(parsed.rows[1].dealerName, "Battlefield Ford");
    assert.equal(parsed.rows[1].contactName, "Jane Doe");
    assert.equal(parsed.rows[1].contactEmail, "jane@battlefieldford.com");
    assert.ok(parsed.unrecognizedColumns.includes("website"));
    assert.ok(parsed.unrecognizedColumns.includes("contact title"));
    assert.ok(parsed.unrecognizedColumns.includes("contact source url"));
    assert.equal(parsed.skippedRows, 0);
  });

  it("skips rows with no dealer name and handles a numeric ZIP cell", async () => {
    const buffer = await buildWorkbookBuffer([
      ["Dealer Name", "Zip"],
      ["", "90210"],
      ["Some Ford", 90210 as unknown as string],
    ]);
    const parsed = await parseDealershipXlsxBuffer(buffer);
    assert.equal(parsed.skippedRows, 1);
    assert.equal(parsed.rows.length, 1);
    assert.equal(parsed.rows[0].zipCode, "90210");
  });

  it("returns an empty result for an empty workbook", async () => {
    const workbook = new ExcelJS.Workbook();
    workbook.addWorksheet("Empty");
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
    const parsed = await parseDealershipXlsxBuffer(buffer);
    assert.deepEqual(parsed, { rows: [], skippedRows: 0, unrecognizedColumns: [] });
  });
});
