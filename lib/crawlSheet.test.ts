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
    const route = fs.readFileSync("app/api/admin/crawl-sheet/route.ts", "utf8");
    assert.match(route, /requireAdminSession\(\)/);
    assert.match(route, /cachedDealerDirectory\(\)/, "served from the directory cache, not a fresh box pull per open");
    assert.match(route, /get\("notes"\) === "1"/, "notes are an opt-in second request");
    assert.match(fs.readFileSync("app/admin/crawl/CrawlSheetClient.tsx", "utf8"), /crawl-sheet\?notes=1/);
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

describe("vehicles sheet — nightly crawl extras", () => {
  it("renders options, price history, change type and the crawl's first-seen date as cells", async () => {
    const { vehicleRowCell, VEHICLE_SHEET_COLUMNS } = await import("./crawlSheetColumns");
    const row = { vin: "5TDAAAB57TS41E883", dealerId: "1", dealerName: "Basil Toyota", dealerCity: "Lockport", dealerState: "NY", condition: "new", year: 2026, make: "Toyota", model: "Grand Highlander", trim: "LE", bodyStyle: null, exteriorColor: null, interiorColor: null, mileage: 0, price: 47102, msrp: 47102, stockNumber: null, vdpUrl: null, imageUrl: null, source: "nightly", firstSeenAt: "2026-09-16T11:00:00.000Z", lastSeenAt: "2026-09-16T11:00:00.000Z", removedAt: null,
      windowStickerUrl: "https://x/sticker.pdf", engine: "4-Cyl. Turbocharged Engine", transmission: null, daysOnLot: 3, oldPrice: 47602, priceDiff: -500, priceChangeType: "DROP", changeType: "NEW_ARRIVAL",
      priceHistory: [{ date: "2026-09-14", price: 47602 }, { date: "2026-09-16", price: 47102 }], options: [{ code: "OPT-49", name: "Mudguards", price: 129, kind: "factory" }, { code: null, name: "Wheel locks", price: 75, kind: "dealer" }], optionsTotal: 204, baseMsrp: null, crawlFirstSeen: "2026-09-14" };
    assert.equal(vehicleRowCell(row, "options"), "Mudguards; Wheel locks");
    assert.equal(vehicleRowCell(row, "priceHistory"), "2026-09-14:47602; 2026-09-16:47102");
    assert.equal(vehicleRowCell(row, "changeType"), "New arrival");
    assert.equal(vehicleRowCell(row, "crawlFirstSeen"), "2026-09-14");
    assert.equal(vehicleRowCell(row, "priceDiff"), "-500");
    for (const k of ["priceDiff", "daysOnLot", "changeType", "windowStickerUrl", "engine", "options", "crawlFirstSeen"]) assert.ok(VEHICLE_SHEET_COLUMNS.some((c) => c.key === k), k);
  });
  it("the dealer sheet carries inventory counts and renders zero as blank", async () => {
    const { crawlRowCell, CRAWL_SHEET_COLUMNS } = await import("./crawlSheetColumns");
    const { crawlRowFromDealership } = await import("./crawlSheet");
    const r = { ...crawlRowFromDealership({ id: "1", dealerName: "Joyce Honda", address: null, city: "Denville", state: "NJ", zipCode: null, phone: null, contactName: null, contactEmail: null, notes: "Brand: Honda", website: null, domains: [], emailOptOut: false, createdAt: "", updatedAt: "" }), inStock: 212, newCount: 0, priceDrops: 9 };
    assert.equal(crawlRowCell(r, "inStock"), "212");
    assert.equal(crawlRowCell(r, "newCount"), "");
    assert.equal(crawlRowCell(r, "priceDrops"), "9");
    assert.ok(CRAWL_SHEET_COLUMNS.some((c) => c.key === "inStock"));
    assert.match(fs.readFileSync("app/admin/crawl/CrawlSheetClient.tsx", "utf8"), /byDealer=1/);
    assert.match(fs.readFileSync("app/api/admin/inventory/route.ts", "utf8"), /byDealer/);
  });
});

describe("VIN history timeline", () => {
  it("lays out every calendar day between first and last observation, marks crawl gaps, and prices deltas on the observed day", async () => {
    const { vinTimeline } = await import("./crawlSheetColumns");
    const listing = { dealerId: "7", firstSeenAt: "2026-09-12T20:00:00.000Z", lastSeenAt: "2026-09-16T11:00:00.000Z", removedAt: null, crawlFirstSeen: "2026-09-10", price: 40017 };
    const days = [
      { dealerId: "7", seenOn: "2026-09-10", price: 45792, mileage: 5 },
      { dealerId: "7", seenOn: "2026-09-14", price: 45792, mileage: null },
      { dealerId: "7", seenOn: "2026-09-16", price: 40017, mileage: 12 },
      { dealerId: "9", seenOn: "2026-09-16", price: 39000, mileage: null }, // another store's row — not this listing's
    ];
    const t = vinTimeline(listing, days, "2026-09-16");
    assert.deepEqual(t.map((x) => x.date), ["2026-09-10", "2026-09-11", "2026-09-12", "2026-09-13", "2026-09-14", "2026-09-15", "2026-09-16"]);
    assert.deepEqual(t.map((x) => x.status), ["seen", "gap", "gap", "gap", "seen", "gap", "seen"]);
    assert.equal(t[0].delta, 0, "first known price shows no change");
    assert.equal(t[1].price, 45792, "gap days carry the last known price");
    assert.equal(t[4].delta, 0);
    assert.equal(t[6].delta, -5775, "the drop lands on the day it was observed");
    assert.equal(t[6].mileage, 12);
  });
  it("closes a removed listing on its removal day and never runs past today", async () => {
    const { vinTimeline } = await import("./crawlSheetColumns");
    const removed = vinTimeline({ dealerId: "1", firstSeenAt: "2026-09-13T00:00:00.000Z", lastSeenAt: "2026-09-14T00:00:00.000Z", removedAt: "2026-09-15T06:15:00.000Z", crawlFirstSeen: null, price: 100 }, [{ dealerId: "1", seenOn: "2026-09-13", price: 100, mileage: null }, { dealerId: "1", seenOn: "2026-09-14", price: 100, mileage: null }], "2026-09-20");
    assert.deepEqual(removed.map((x) => `${x.date}:${x.status}`), ["2026-09-13:seen", "2026-09-14:seen", "2026-09-15:removed"]);
    const live = vinTimeline({ dealerId: "1", firstSeenAt: "2026-09-15T00:00:00.000Z", lastSeenAt: "2026-09-30T00:00:00.000Z", removedAt: null, crawlFirstSeen: null, price: 1 }, [], "2026-09-16");
    assert.equal(live[live.length - 1].date, "2026-09-16", "a lastSeen in the future (clock skew) is clamped to today");
    assert.deepEqual(vinTimeline(null, [], "2026-09-16"), []);
  });
  it("the Vehicles tab wires the VIN panel through the admin route", () => {
    const sheet = fs.readFileSync("app/admin/crawl/VehiclesSheet.tsx", "utf8");
    assert.match(sheet, /VinHistory/);
    assert.match(fs.readFileSync("app/admin/crawl/VinHistory.tsx", "utf8"), /\/api\/admin\/inventory\?vin=/);
    assert.match(fs.readFileSync("app/api/admin/inventory/route.ts", "utf8"), /inventoryVin\(/);
  });
});

describe("vehicles CSV export — streamed from the box", () => {
  const ndjson = (lines: string[], split = 7) => {
    const text = lines.join("\n");
    const chunks: Uint8Array[] = [];
    // Split mid-line so the parser has to buffer partial lines across chunks.
    for (let i = 0; i < text.length; i += split) chunks.push(new TextEncoder().encode(text.slice(i, i + split)));
    return new Response(new ReadableStream({ start(c) { chunks.forEach((x) => c.enqueue(x)); c.close(); } }), { status: 200 });
  };
  const run = async (res: Response) => {
    process.env.LIGHTSAIL_API_KEY = "test-key";
    const realFetch = globalThis.fetch;
    let url = "";
    globalThis.fetch = (async (u: string) => { url = u; return res; }) as typeof fetch;
    try {
      const { exportInventory } = await import("./inventoryApi");
      const gen = exportInventory({ state: "TX", inStock: true });
      const vins: string[] = [];
      let r = await gen.next();
      while (!r.done) { vins.push(r.value.vin); r = await gen.next(); }
      return { vins, capped: r.value.capped, url };
    } finally {
      globalThis.fetch = realFetch;
    }
  };

  it("yields every row and reads the done trailer, with the filter forwarded to the box", async () => {
    const out = await run(ndjson(['{"vin":"A1"}', '{"vin":"B2"}', '{"done":true,"rows":2,"capped":false}', ""]));
    assert.deepEqual(out.vins, ["A1", "B2"]);
    assert.equal(out.capped, false);
    assert.match(out.url, /\/api\/inventory\/export\?state=TX&inStock=1$/);
  });

  it("throws when the stream ends without its done trailer, so a truncated CSV never looks complete", async () => {
    await assert.rejects(run(ndjson(['{"vin":"A1"}', '{"vin":"B2"}'])), /cut off/);
  });

  it("surfaces an error line from the box", async () => {
    await assert.rejects(run(ndjson(['{"vin":"A1"}', '{"error":"Export failed partway through"}'])), /Export failed partway through/);
  });

  it("the streamed header + lines build the same CSV as the one-shot helper", async () => {
    const { vehicleCsvHeader, vehicleCsvLine, vehicleRowsToCsv } = await import("./crawlSheetColumns");
    const row = { vin: "1HGCM82633A004352", dealerName: "=Joyce, Honda", price: 30000, options: [{ code: "X", name: "Sunroof", price: 1, kind: "o" }] } as never;
    assert.equal(vehicleCsvHeader() + vehicleCsvLine(row), vehicleRowsToCsv([row]));
  });
});
