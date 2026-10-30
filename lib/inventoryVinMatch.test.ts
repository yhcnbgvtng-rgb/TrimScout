import "./testdata/blockLiveHttp";
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { findByVin } from "./inventoryVinMatch";
import { normalizeVinQuery } from "./inventoryVinQuery";
import { GET } from "../app/api/vehicles/vin/route";

const FULL = "1HGCM82633A004352";
const row = (over: Record<string, unknown>) => ({
  vin: FULL, dealerId: "7", dealerName: "Acme Honda", dealerCity: "Newark", dealerState: "NJ", condition: "used", year: 2023, make: "Honda", model: "Accord", trim: "EX",
  price: 25000, firstSeenAt: "2026-10-01T06:00:00.000Z", lastSeenAt: "2026-10-30T06:00:00.000Z", crawlFirstSeen: "2026-09-30", sourceBox: "box2", removedAt: null, ...over,
});

let urls: string[] = [];
const saved = { fetch: globalThis.fetch, key: process.env.LIGHTSAIL_API_KEY };
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
function mockBox(routes: { full?: unknown[]; suffix?: unknown[] | "404"; truncated?: boolean }) {
  globalThis.fetch = (async (url: string) => {
    const u = String(url);
    urls.push(u);
    if (u.includes("/api/inventory/vin/")) return json(200, { vin: FULL, listings: routes.full ?? [], days: [] });
    if (u.includes("/api/inventory/vin-search")) return routes.suffix === "404" ? json(404, { error: "Not found" }) : json(200, { suffix: "A004352", truncated: Boolean(routes.truncated), vehicles: routes.suffix ?? [] });
    return json(500, { error: "unused" }); // dealer directory etc.: the contact index falls back to unknown
  }) as typeof fetch;
}
const full = normalizeVinQuery(FULL);
const suffix = normalizeVinQuery("a004352");
assert.ok(full.ok && suffix.ok);

describe("findByVin", () => {
  beforeEach(() => { urls = []; process.env.LIGHTSAIL_API_KEY = "test-key"; });
  afterEach(() => { globalThis.fetch = saved.fetch; if (saved.key === undefined) delete process.env.LIGHTSAIL_API_KEY; else process.env.LIGHTSAIL_API_KEY = saved.key; });

  it("a full VIN is an exact lookup on the existing /api/inventory/vin/:vin endpoint and returns that listing", async () => {
    mockBox({ full: [row({})] });
    const r = await findByVin(full as never);
    assert.ok(urls.some((u) => u.endsWith(`/api/inventory/vin/${FULL}`)));
    assert.ok(!urls.some((u) => u.includes("vin-search")));
    assert.equal(r.vehicles.length, 1);
    assert.equal(r.vehicles[0].vin, FULL);
  });

  it("the last 6-8 characters call vin-search with the suffix and return every match", async () => {
    mockBox({ suffix: [row({}), row({ vin: "5YJ3E1EA7KF004352", dealerId: "9", make: "Tesla" })] });
    const r = await findByVin(suffix as never);
    assert.ok(urls.some((u) => u.includes("/api/inventory/vin-search?suffix=A004352")));
    assert.deepEqual(r.vehicles.map((v) => v.vin).sort(), [FULL, "5YJ3E1EA7KF004352"].sort());
    assert.equal(r.truncated, false);
  });

  it("no match is an empty list, and a removed listing does not count as current inventory", async () => {
    mockBox({ full: [row({ removedAt: "2026-10-20T00:00:00.000Z" })] });
    assert.deepEqual((await findByVin(full as never)).vehicles, []);
    mockBox({ suffix: [] });
    assert.deepEqual((await findByVin(suffix as never)).vehicles, []);
  });

  it("returns one row per VIN when a store group lists it on several rooftops", async () => {
    mockBox({ full: [row({ dealerId: "7" }), row({ dealerId: "8", dealerName: "Sister Honda" })] });
    assert.equal((await findByVin(full as never)).vehicles.length, 1);
  });

  it("never carries first/last-seen dates in what the buyer gets", async () => {
    mockBox({ full: [row({})] });
    const body = JSON.stringify((await findByVin(full as never)).vehicles);
    assert.doesNotMatch(body, /seen/i);
    assert.doesNotMatch(body, /\d{4}-\d{2}-\d{2}/);
  });

  it("a box without the vin-search patch gives a clear error for a suffix, not a crash", async () => {
    mockBox({ suffix: "404" });
    await assert.rejects(() => findByVin(suffix as never), /isn't available yet/);
  });
});

describe("GET /api/vehicles/vin", () => {
  beforeEach(() => { urls = []; process.env.LIGHTSAIL_API_KEY = "test-key"; });
  afterEach(() => { globalThis.fetch = saved.fetch; if (saved.key === undefined) delete process.env.LIGHTSAIL_API_KEY; else process.env.LIGHTSAIL_API_KEY = saved.key; });
  const call = (vin: string) => GET(new Request(`http://localhost/api/vehicles/vin?vin=${encodeURIComponent(vin)}`));

  it("rejects I/O/Q and bad lengths with 400 before touching the box", async () => {
    mockBox({});
    assert.equal((await call("1HGCM82633A00435O")).status, 400);
    assert.equal((await call("12345")).status, 400);
    assert.deepEqual(urls, []);
  });
  it("answers a match with kind and vehicles, and a miss with an empty list (the page shows the no-match message)", async () => {
    mockBox({ full: [row({})] });
    const hit = await (await call(" 1hgcm82633a004352 ")).json();
    assert.equal(hit.kind, "full");
    assert.equal(hit.vehicles.length, 1);
    mockBox({ full: [] });
    const miss = await call(FULL);
    assert.equal(miss.status, 200);
    assert.deepEqual((await miss.json()).vehicles, []);
  });
});
