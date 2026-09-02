import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseCsvTable, parseDealershipCsv } from "./dealershipCsv";

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
