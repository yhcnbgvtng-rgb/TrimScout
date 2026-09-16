import assert from "node:assert/strict";
import { describe, it } from "node:test";
import fs from "node:fs";
import { brandsFromName, brandsFromNotes, crawlRowFromDealership, staffPageStatus } from "./crawlSheet";
import { CRAWL_SHEET_COLUMNS, crawlRowsToCsv } from "./crawlSheetColumns";
import type { Dealership } from "./dealershipsApi";

const base: Dealership = { id: "1", dealerName: "Joyce Honda", address: "1 Route 10", city: "Denville", state: "nj", zipCode: "07834", phone: "(973) 000-0000", contactName: null, contactEmail: null, notes: null, website: "https://www.joycehonda.com/", domains: ["joycehonda.com"], emailOptOut: false, createdAt: "", updatedAt: "2026-09-15" };

describe("crawl sheet — notes become columns", () => {
  it("reads brand, title, source, staff-page result and lead inbox out of the crawl notes", () => {
    const r = crawlRowFromDealership({ ...base, contactName: "Amy Musleh", contactEmail: "amy.musleh@openroad.com", notes: "Title: General Manager | Website: https://www.morristownmini.com/ | Source: https://www.morristownmini.com/staff/ | Lead inbox: leads@morristownmini.com | Brand: MINI" });
    assert.deepEqual(r.brands, ["MINI"]);
    assert.equal(r.contactTitle, "General Manager");
    assert.equal(r.source, "https://www.morristownmini.com/staff/");
    assert.equal(r.staffPage, "captured");
    assert.equal(r.leadInbox, "leads@morristownmini.com");
    assert.equal(r.emailKind, "named");
    assert.equal(r.emailSource, "staff_page");
    assert.equal(r.contactReady, true);
    assert.equal(r.state, "NJ");
  });
  it("classifies generic inboxes and empty rows, and never calls those contact-ready", () => {
    const g = crawlRowFromDealership({ ...base, contactName: "Bob Jones", contactEmail: "sales@joycehonda.com", notes: "Brand: Honda" });
    assert.equal(g.emailKind, "generic");
    assert.equal(g.contactReady, false);
    const n = crawlRowFromDealership({ ...base, notes: "Staff page: blocked | Brand: Honda" });
    assert.equal(n.emailKind, "none");
    assert.equal(n.staffPage, "blocked");
    assert.equal(n.emailSource, "");
    assert.equal(staffPageStatus("Staff page: no_staff_page | Brand: Kia", "https://x.com"), "no_staff_page");
    assert.equal(staffPageStatus("Brand: Kia", ""), "no_website");
  });
  it("tags where an email came from — recovery and promotion stamps beat the staff-page default", () => {
    const rec = crawlRowFromDealership({ ...base, contactName: "Jim Raub", contactEmail: "jraub@cochran.com", notes: "Title: GM | Source: https://x.com/staff/ | Brand: Buick | 2026-09-15: email recovered from staff-page HTML source (https://x.com/staff/)" });
    assert.equal(rec.emailSource, "html_recovery");
    const pro = crawlRowFromDealership({ ...base, contactName: "Jim Raub", contactEmail: "leads@x.com", notes: "Lead inbox: leads@x.com | Brand: Mazda | 2026-09-15: lead inbox promoted to contact email (store's registered lead mailbox; may not be the named contact's own)" });
    assert.equal(pro.emailSource, "lead_inbox");
  });
  it("falls back to the dealer name for a brand when the crawl left no tag", () => {
    assert.deepEqual(brandsFromNotes("Brand: Chevrolet | Title: GM | Brand: Buick"), ["Chevrolet", "Buick"]);
    assert.deepEqual(brandsFromName("Paul Miller Chevrolet Buick GMC"), ["Chevrolet", "Buick", "GMC"]);
    assert.deepEqual(brandsFromName("Route 23 Auto Mall"), []);
    assert.deepEqual(crawlRowFromDealership({ ...base, dealerName: "Ray Catena Mercedes Benz" }).brands, ["Mercedes-Benz"]);
  });
  it("CSV carries exactly the requested columns, quotes notes, and defuses formula-looking cells", () => {
    const r = crawlRowFromDealership({ ...base, contactName: "=SUM(1)", notes: 'Title: GM, "Sales" | Brand: Honda' });
    const csv = crawlRowsToCsv([r], ["dealerName", "contactName", "brands", "contactTitle"]);
    assert.equal(csv.split("\r\n")[0], "Dealer,Contact,Brand,Title");
    assert.match(csv, /"=SUM\(1\)"/);
    assert.match(csv, /"GM, ""Sales"""/);
    assert.equal(CRAWL_SHEET_COLUMNS.some((c) => c.key === "notes"), true);
  });
  it("the admin page imports only the client-safe module, and the API requires an admin session", () => {
    const client = fs.readFileSync("app/admin/crawl/CrawlSheetClient.tsx", "utf8");
    assert.match(client, /from "@\/lib\/crawlSheetColumns"/);
    assert.doesNotMatch(client, /from "@\/lib\/crawlSheet"/);
    assert.doesNotMatch(fs.readFileSync("lib/crawlSheetColumns.ts", "utf8"), /^import /m, "no imports at all — safe for the browser bundle");
    assert.match(fs.readFileSync("app/api/admin/crawl-sheet/route.ts", "utf8"), /requireAdminSession\(\)/);
  });
});

describe("vehicles sheet", () => {
  it("vehicle CSV carries the sheet's columns, formats dates as days, and stays client-safe", async () => {
    const { VEHICLE_SHEET_COLUMNS, vehicleRowsToCsv } = await import("./crawlSheetColumns");
    const row = { vin: "3GNAXPEG2VL114131", dealerId: "11556", dealerName: "McGuire Chevrolet", dealerCity: "Clare", dealerState: "NJ", condition: "new", year: 2027, make: "Chevrolet", model: "Equinox", trim: "LT", bodyStyle: "SUV", exteriorColor: "Radiant Red Tintcoat", interiorColor: null, mileage: null, price: 35945, msrp: 35945, stockNumber: "227014", vdpUrl: "https://www.mcguirechevrolet.com/new-Clare-2027-Chevrolet-Equinox-LT-3GNAXPEG2VL114131", imageUrl: null, source: "jsonld", firstSeenAt: "2026-09-16T11:02:03.000Z", lastSeenAt: "2026-09-16T11:02:03.000Z", removedAt: null };
    const csv = vehicleRowsToCsv([row], ["dealerName", "vin", "price", "firstSeenAt"]);
    assert.equal(csv.split("\r\n")[0], "Dealer,VIN,Price,First seen");
    assert.equal(csv.split("\r\n")[1], "McGuire Chevrolet,3GNAXPEG2VL114131,35945,2026-09-16");
    assert.ok(VEHICLE_SHEET_COLUMNS.some((c) => c.key === "vdpUrl"));
    const client = fs.readFileSync("app/admin/crawl/VehiclesSheet.tsx", "utf8");
    assert.match(client, /from "@\/lib\/crawlSheetColumns"/);
    assert.doesNotMatch(client, /from "@\/lib\/inventoryApi"/, "the inventory client is server-only");
    assert.match(fs.readFileSync("app/api/admin/inventory/route.ts", "utf8"), /requireAdminSession\(\)/);
  });
  it("inventoryQueryString only sends set filters and turns inStock into 1", async () => {
    const { inventoryQueryString } = await import("./inventoryApi");
    assert.equal(inventoryQueryString({ state: "NJ", make: "", inStock: true, limit: 500, offset: 0 }), "?state=NJ&inStock=1&limit=500&offset=0");
    assert.equal(inventoryQueryString({}), "");
  });
});
