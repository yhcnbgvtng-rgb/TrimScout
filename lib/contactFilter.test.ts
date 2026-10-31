/**
 * "Dealer contact on file" buyer filter. The dealer set comes from the SAME shared function as the search Contact column and Step 3
 * (hasContactOnFile via contactStatus), so filter, column and Step 3 agree. A fake deals-api stands in for the box: it applies the
 * dealer ids it is sent exactly as inventoryListQuery/contactFacetQueries do (the SQL side is pinned in the crawler's own tests), so these
 * tests prove the web side sends the right set, only when the box is asked to, and that count, list and facets come from one set.
 *
 * Rule (PR #458): "contact on file" = a NAMED contact. An email with no person's name is a sales desk in Step 3 and No in the column,
 * so the filter leaves it out too.
 */
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { buildContactIndex } from "./dealerContactIndex";
import { contactOnFileDealerIds } from "./contactFilter";
import { parseBuyerSearchParams } from "./buyerSearchQuery";
import { runBuyerSearch } from "./buyerSearch";
import { inventoryFacets, InventoryApiError } from "./inventoryApi";
import { publicDeskFor } from "./publicDesk";
import type { Dealership } from "./dealershipsApi";

const fixture = JSON.parse(fs.readFileSync(new URL("./fixtures/box2-dealer-rows.json", import.meta.url), "utf8")) as Dealership[];
function row(over: Partial<Dealership>): Dealership {
  return { id: "1", dealerName: "Test Motors", address: null, city: "Town", state: "NJ", zipCode: null, phone: null, contactName: null, contactEmail: null, notes: null, website: null, domains: [], emailOptOut: false, createdAt: "", updatedAt: "", ...over };
}
const NAMED = row({ id: "9001", dealerName: "Named Honda", contactName: "Maria Lopez", contactEmail: "mlopez@namedhonda.com" });
const EMAIL_NO_NAME = row({ id: "9002", dealerName: "Glen Motors, Inc.", state: "NJ", contactEmail: "jforkins@glentoyota.com" });
const NO_EMAIL = row({ id: "9003", dealerName: "Nobody Kia" });
const OPTED_OUT = row({ id: "9004", dealerName: "Gone Auto", contactName: "Sam Gone", contactEmail: "sam@gone.com", emailOptOut: true });
const TEST_DEALER = { ...row({ id: "9005", dealerName: "Audit Test Motors", contactName: "Tess Ter", contactEmail: "tess@audit.test" }), isTest: true } as Dealership;
const DIRECTORY = [...fixture, NAMED, EMAIL_NO_NAME, NO_EMAIL, OPTED_OUT, TEST_DEALER];
const BAYSIDE_NY = fixture.find((r) => r.id === "4046")!;
const ROSEVILLE = fixture.find((r) => r.id === "7632")!;

describe("which dealers the filter keeps", () => {
  const ids = contactOnFileDealerIds(buildContactIndex(DIRECTORY));
  it("keeps a named contact", () => assert.ok(ids.includes("9001")));
  it("a dealer with a reachable email but no name IS on file (isQuoteReachable, same as Step 3's green badge)", () => {
    assert.ok(ids.includes("9002"));
    const d = publicDeskFor(DIRECTORY, { dealerName: "Glen Motors", state: "NJ" });
    assert.equal(d.contactState, "email_only");
    assert.equal(ids.includes("9002"), (["named", "email_only"] as string[]).includes(d.contactState));
  });
  it("a dealer with no email is excluded", () => assert.ok(!ids.includes("9003")));
  it("an unsubscribed dealer is excluded", () => assert.ok(!ids.includes("9004")));
  it("a test dealer (is_test) is excluded even with a named contact", () => assert.ok(!ids.includes("9005")));
  it("Bayside CDJR and BMW of Roseville: filter and Step 3 agree", () => {
    for (const r of [BAYSIDE_NY, ROSEVILLE]) {
      const step3 = publicDeskFor(DIRECTORY, { dealerName: r.dealerName.replace(/ \(.*\)$/, ""), state: r.state || "" });
      assert.equal(ids.includes(r.id), step3.contactState === "named" || step3.contactState === "email_only", r.dealerName);
    }
    assert.equal(ids.includes(BAYSIDE_NY.id), false, "Bayside CDJR (NY) has nothing reachable");
  });
  it("for every directory row the filter set equals 'Step 3 says reachable (named or email-only)'", () => {
    for (const r of DIRECTORY.filter((x) => !(x as { isTest?: boolean }).isTest)) {
      const step3 = publicDeskFor(DIRECTORY, { dealerName: r.dealerName.replace(/ \(.*\)$/, ""), state: r.state || "" });
      assert.equal(ids.includes(r.id), step3.contactState === "named" || step3.contactState === "email_only", r.dealerName);
    }
  });
});

describe("param parsing", () => {
  const sp = (extra: string) => new URLSearchParams(`make=Toyota${extra}`);
  afterEach(() => { delete process.env.NEXT_PUBLIC_CONTACT_FILTER; });
  it("contactOnFile=1 turns it on when the filter is enabled", () => {
    process.env.NEXT_PUBLIC_CONTACT_FILTER = "1";
    assert.equal(parseBuyerSearchParams(sp("&contactOnFile=1")).contactOnFile, true);
    assert.equal(parseBuyerSearchParams(sp("")).contactOnFile, false, "off by default");
    assert.equal(parseBuyerSearchParams(sp("&contactOnFile=0")).contactOnFile, false);
  });
  it("is ignored until the box is ready (flag off)", () => {
    assert.equal(parseBuyerSearchParams(sp("&contactOnFile=1")).contactOnFile, false);
  });
});

// ---- fake deals-api + directory -------------------------------------------------------------------------------------------------
type Car = { vin: string; dealerId: string; dealerName: string; dealerState: string; state: string; make: string; model: string };
const CARS: Car[] = [];
let n = 0;
for (const [r, count] of [[NAMED, 3], [EMAIL_NO_NAME, 2], [NO_EMAIL, 4], [OPTED_OUT, 1], [TEST_DEALER, 1], [ROSEVILLE, 2], [BAYSIDE_NY, 2]] as const) {
  for (let i = 0; i < count; i++) CARS.push({ vin: `VIN${++n}`, dealerId: r.id, dealerName: r.dealerName, dealerState: r.state || "", state: r.state || "", make: "Toyota", model: i % 2 ? "RAV4" : "Camry" });
}
const calls: Array<{ method: string; path: string; body: any }> = [];
let boxPatched = true;
const realFetch = globalThis.fetch;
function fakeFetch(url: any, init?: any): Promise<Response> {
  const u = new URL(String(url));
  const body = init?.body ? JSON.parse(init.body) : null;
  calls.push({ method: init?.method || "GET", path: u.pathname, body });
  const json = (o: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json" } }));
  if (u.port === "3003") return json({ dealerships: DIRECTORY });
  const page = (cars: Car[], dealers?: number) => ({ total: cars.length, limit: 50, offset: 0, vehicles: cars.map((c) => ({ ...c, dealerCity: "", sourceBox: "b" })), ...(dealers !== undefined ? { contactFilter: { dealers } } : {}) });
  const facets = (cars: Car[], dealers?: number) => {
    const count = (key: "state" | "make" | "model") => Object.entries(cars.reduce<Record<string, number>>((a, c) => ((a[c[key]] = (a[c[key]] || 0) + 1), a), {})).map(([v, c]) => ({ [key]: v, n: c }));
    return { states: count("state"), makes: count("make"), models: count("model"), trims: [], ...(dealers !== undefined ? { contactFilter: { dealers } } : {}) };
  };
  if (u.pathname === "/api/inventory/contact-search") return boxPatched ? json(page(CARS.filter((c) => body.dealerIds.map(String).includes(c.dealerId)), body.dealerIds.length)) : json({ error: "Not found" }, 404);
  if (u.pathname === "/api/inventory/contact-facets") return boxPatched ? json(facets(CARS.filter((c) => body.dealerIds.map(String).includes(c.dealerId)), body.dealerIds.length)) : json({ error: "Not found" }, 404);
  if (u.pathname === "/api/inventory") return json(page(CARS));
  if (u.pathname === "/api/inventory/facets") return json(facets(CARS));
  return json({ error: "unexpected " + u.pathname }, 500);
}

describe("buyer search with the filter on vs off", () => {
  beforeEach(() => { calls.length = 0; boxPatched = true; process.env.LIGHTSAIL_API_KEY = "test-key"; process.env.NEXT_PUBLIC_CONTACT_FILTER = "1"; globalThis.fetch = fakeFetch as typeof fetch; });
  afterEach(() => { globalThis.fetch = realFetch; delete process.env.NEXT_PUBLIC_CONTACT_FILTER; });
  const parse = (extra = "") => parseBuyerSearchParams(new URLSearchParams(`make=Toyota${extra}`));

  it("off: the plain GET list, every car, no dealer ids sent", async () => {
    const r = await runBuyerSearch(parse());
    assert.equal(r.total, CARS.length);
    assert.equal(r.vehicles.length, CARS.length);
    assert.ok(calls.some((c) => c.method === "GET" && c.path === "/api/inventory"));
    assert.ok(!calls.some((c) => c.path.startsWith("/api/inventory/contact-")));
  });

  it("on: only cars whose dealer has a contact on file; the count equals the list, and every row says Yes in the Contact column", async () => {
    const r = await runBuyerSearch(parse("&contactOnFile=1"));
    assert.equal(r.total, r.vehicles.length);
    assert.equal(r.vehicles.length, 5, "Named Honda's 3 cars + Glen Motors' 2 (a reachable email with no name); Roseville's autonation address is unverified here");
    assert.ok(r.vehicles.every((v) => v.dealerHasContact === true), "filter and column agree row by row");
    assert.deepEqual([...new Set(r.vehicles.map((v) => v.dealerName))].sort(), ["Glen Motors, Inc.", "Named Honda"]);
    const post = calls.find((c) => c.path === "/api/inventory/contact-search")!;
    assert.equal(post.method, "POST");
    assert.deepEqual(post.body.dealerIds, contactOnFileDealerIds(buildContactIndex(DIRECTORY)));
    assert.match(post.body.query, /make=Toyota/);
    assert.match(post.body.query, /retailOnly=1/, "the usual buyer rules (retail, in stock, not stale) still ride along");
    assert.match(post.body.query, /seenWithinDays=/);
  });

  it("on: no car of a no-email, unsubscribed or test dealer comes back", async () => {
    const r = await runBuyerSearch(parse("&contactOnFile=1"));
    for (const bad of ["Nobody Kia", "Gone Auto", "Audit Test Motors", "BMW of Roseville", "Bayside Chrysler Dodge Jeep Ram (Bayside, NY)"]) assert.ok(!r.vehicles.some((v) => v.dealerName === bad), bad);
  });

  it("the facets follow the filter and sum to the list's count", async () => {
    const ids = contactOnFileDealerIds(buildContactIndex(DIRECTORY));
    const list = await runBuyerSearch(parse("&contactOnFile=1"));
    const f = await inventoryFacets({ make: "Toyota" }, { dealerIds: ids });
    assert.equal(f.makes.reduce((a, m) => a + m.n, 0), list.total);
    assert.equal(f.states.reduce((a, s) => a + s.n, 0), list.total);
    assert.equal(f.models.reduce((a, m) => a + m.n, 0), list.total);
    const off = await inventoryFacets({ make: "Toyota" });
    assert.equal(off.makes.reduce((a, m) => a + m.n, 0), CARS.length, "off: unfiltered counts");
  });

  it("an unpatched box is an error, never an unfiltered list under a checked box", async () => {
    boxPatched = false;
    await assert.rejects(runBuyerSearch(parse("&contactOnFile=1")), (e: unknown) => e instanceof InventoryApiError && e.status === 404);
  });

  it("a box that answers without echoing the filter is refused", async () => {
    globalThis.fetch = ((url: any, init?: any) => String(url).includes(":3003") ? fakeFetch(url, init) : Promise.resolve(new Response(JSON.stringify({ total: 9, limit: 50, offset: 0, vehicles: [] }), { status: 200 }))) as typeof fetch;
    await assert.rejects(runBuyerSearch(parse("&contactOnFile=1")), /did not apply/);
  });
});
