import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  dealershipsToCsv,
  dealershipsToTable,
  dealershipExportFilename,
  tableToCsv,
  parseCsvTable,
  parseDealershipCsv,
  type ExportableDealership,
} from "./dealershipCsv";

describe("parseCsvTable", () => {
  it("splits plain comma-separated rows", () => {
    const table = parseCsvTable("a,b,c\n1,2,3\n");
    assert.deepEqual(table, [
      ["a", "b", "c"],
      ["1", "2", "3"],
    ]);
  });

  it("handles quoted fields with embedded commas and escaped quotes", () => {
    const table = parseCsvTable('Name,Note\n"Stevens Creek, Chevrolet","Says ""call first"""\n');
    assert.deepEqual(table, [
      ["Name", "Note"],
      ["Stevens Creek, Chevrolet", 'Says "call first"'],
    ]);
  });

  it("handles a file with no trailing newline", () => {
    const table = parseCsvTable("a,b\n1,2");
    assert.deepEqual(table, [
      ["a", "b"],
      ["1", "2"],
    ]);
  });
});

describe("parseDealershipCsv", () => {
  it("maps a Ford GM-contact style export onto dealership fields", () => {
    const csv = [
      "Dealer Name,City,State,GM Name,GM Email",
      "Stevens Creek Ford,San Jose,CA,Jordan Reyes,jordan@stevenscreekford.com",
      "Downtown Ford,Chicago,IL,Alex Kim,alex@downtownford.com",
    ].join("\n");
    const result = parseDealershipCsv(csv);
    assert.equal(result.skippedRows, 0);
    assert.deepEqual(result.unrecognizedColumns, []);
    assert.equal(result.rows.length, 2);
    assert.deepEqual(result.rows[0], {
      dealerName: "Stevens Creek Ford",
      city: "San Jose",
      state: "CA",
      contactName: "Jordan Reyes",
      contactEmail: "jordan@stevenscreekford.com",
    });
  });

  it("maps a differently-worded manufacturer export the same way", () => {
    const csv = [
      "Dealership,General Manager,Contact Email,Phone Number",
      "Capitol Chevrolet,Sam Ortiz,sam@capitolchevy.com,(512) 555-0100",
    ].join("\n");
    const result = parseDealershipCsv(csv);
    assert.equal(result.rows.length, 1);
    assert.deepEqual(result.rows[0], {
      dealerName: "Capitol Chevrolet",
      contactName: "Sam Ortiz",
      contactEmail: "sam@capitolchevy.com",
      phone: "(512) 555-0100",
    });
  });

  it("drops rows with no dealer name and counts them", () => {
    const csv = ["Dealer Name,GM Email", ",noname@example.com", "Real Dealer,real@example.com"].join("\n");
    const result = parseDealershipCsv(csv);
    assert.equal(result.rows.length, 1);
    assert.equal(result.skippedRows, 1);
  });

  it("reports unrecognized columns without dropping recognized ones", () => {
    const csv = ["Dealer Name,Fax,GM Email", "Some Dealer,555-1234,gm@example.com"].join("\n");
    const result = parseDealershipCsv(csv);
    assert.deepEqual(result.unrecognizedColumns, ["fax"]);
    assert.equal(result.rows[0].contactEmail, "gm@example.com");
  });

  it("returns empty result for an empty file", () => {
    assert.deepEqual(parseDealershipCsv(""), { rows: [], skippedRows: 0, unrecognizedColumns: [] });
  });
});

const EXPORT_FIXTURE: ExportableDealership[] = [
  {
    dealerName: "Bachrodt BMW",
    address: "4930 E State St",
    city: "Rockford",
    state: "IL",
    zipCode: "61108",
    phone: "(815) 555-0100",
    contactName: "Charlie Hansmeyer",
    contactEmail: "chansmeyer@bachrodt.com",
    notes: 'GM; said "call after 10", prefers email',
    emailOptOut: false,
    updatedAt: "2026-09-10T14:00:00.000Z",
  },
  {
    dealerName: "Paul Miller BMW",
    address: null,
    city: "Wayne",
    state: "NJ",
    zipCode: null,
    phone: null,
    contactName: null,
    contactEmail: null,
    notes: "line one\nline two",
    emailOptOut: true,
    updatedAt: "2026-09-11T09:30:00.000Z",
  },
];

describe("dealership export", () => {
  it("round-trips through the upload parser with every data field intact", () => {
    const result = parseDealershipCsv(dealershipsToCsv(EXPORT_FIXTURE));
    assert.equal(result.skippedRows, 0);
    assert.equal(result.rows.length, 2);
    assert.deepEqual(result.rows[0], {
      dealerName: "Bachrodt BMW",
      address: "4930 E State St",
      city: "Rockford",
      state: "IL",
      zipCode: "61108",
      phone: "(815) 555-0100",
      contactName: "Charlie Hansmeyer",
      contactEmail: "chansmeyer@bachrodt.com",
      notes: 'GM; said "call after 10", prefers email',
    });
    // Nulls export as blanks and come back as absent, not as the string "null".
    assert.deepEqual(result.rows[1], { dealerName: "Paul Miller BMW", city: "Wayne", state: "NJ", notes: "line one\nline two" });
  });

  it("keeps opt-out and updated as read-only columns the importer ignores", () => {
    // Re-uploading an export must never flip opt-out — it only moves via the
    // unsubscribe link — so these headers deliberately match no alias.
    const result = parseDealershipCsv(dealershipsToCsv(EXPORT_FIXTURE));
    assert.deepEqual(result.unrecognizedColumns, ["email opt-out", "updated"]);
    const table = dealershipsToTable(EXPORT_FIXTURE);
    // Website and Domains sit between Contact Email and Notes; opt-out and updated are last.
    assert.equal(table[0][8], "Website");
    assert.equal(table[0][9], "Domains");
    assert.equal(table[1][11], "");
    assert.equal(table[2][11], "yes");
    assert.equal(table[2][12], "2026-09-11T09:30:00.000Z");
  });

  it("round-trips website and domains, splitting the sheet's list on semicolons", () => {
    const withSite = [{ ...EXPORT_FIXTURE[0], website: "https://www.loubachrodtbmw.com/", domains: ["loubachrodtbmw.com", "bachrodtbmw.com"] }];
    const result = parseDealershipCsv(dealershipsToCsv(withSite));
    assert.equal(result.rows[0].website, "https://www.loubachrodtbmw.com/");
    assert.deepEqual(result.rows[0].domains, ["loubachrodtbmw.com", "bachrodtbmw.com"]);
  });

  it("quotes commas, quotes, newlines and formula-looking cells", () => {
    const csv = tableToCsv([["a,b", 'say "hi"', "l1\nl2", "=SUM(1)", "plain"]]);
    assert.equal(csv, '"a,b","say ""hi""","l1\nl2","=SUM(1)",plain\r\n');
  });

  it("names the file by date and format", () => {
    const at = new Date("2026-09-12T18:00:00Z");
    assert.equal(dealershipExportFilename("csv", at), "trimscout-dealership-contacts-2026-09-12.csv");
    assert.equal(dealershipExportFilename("xlsx", at), "trimscout-dealership-contacts-2026-09-12.xlsx");
  });
});
