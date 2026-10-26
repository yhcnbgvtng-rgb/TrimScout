import "./testdata/blockLiveHttp";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { env } from "node:process";
import { toBuyerVehicle } from "./buyerSearch";
import { publicListingSheets, shopperSheetFromMarketCheckPayloads } from "./listingSheet";
import { withoutSeenDates } from "./seenDates";
import { GET } from "../app/api/lightsail/route";
import { LIGHTSAIL_SECRET_HEADER } from "./lightsailAccess";
import type { InventoryVehicle } from "./inventoryApi";

// Buyers never see when the crawl first or last saw a car. The age works quietly (lastConfirmed.ts); admins see the dates.
const SEEN_KEY = /(first|last)_?seen/i;
const ISO_DATE = /\d{4}-\d{2}-\d{2}/;
const keysOf = (v: unknown): string[] => (Array.isArray(v) ? v.flatMap(keysOf) : v && typeof v === "object" ? Object.entries(v).flatMap(([k, x]) => [k, ...keysOf(x)]) : []);

describe("public payloads carry no first/last seen dates", () => {
  it("the buyer search vehicle has no seen key and no crawl date anywhere in its JSON", () => {
    const inv = { vin: "1HGCM82633A004352", dealerName: "X", dealerId: "1", firstSeenAt: "2026-10-01T06:28:19.000Z", lastSeenAt: "2026-10-22T06:28:19.000Z", crawlFirstSeen: "2026-09-30", sourceBox: "box4", removedAt: null } as unknown as InventoryVehicle;
    const b = toBuyerVehicle(inv, null, null);
    assert.deepEqual(keysOf(b).filter((k) => SEEN_KEY.test(k)), []);
    assert.doesNotMatch(JSON.stringify(b), ISO_DATE);
  });

  it("the shopper listing sheet (offer sheet facts) has none", () => {
    const row = { id: "1", first_seen_at: 1790000000, first_seen_at_date: "2026-10-01", last_seen_at: 1790600000, last_seen_at_date: "2026-10-22", scraped_at: 1790600000, price: 40000, dom: 12 };
    const sheet = shopperSheetFromMarketCheckPayloads({ vin: "1HGCM82633A004352", searchListing: row });
    for (const s of [sheet, ...publicListingSheets([sheet])]) assert.deepEqual(keysOf(s).filter((k) => SEEN_KEY.test(k)), []);
  });

  it("withoutSeenDates drops every spelling at any depth and keeps the rest", () => {
    const out = withoutSeenDates({ vin: "V", firstSeen: "a", lastSeen: "b", first_seen_at: "c", lastSeenAt: "d", firstSeenDate: "e", last_seen_date: "f", nested: [{ x: 1, last_seen_at: "g" }], daysOnLot: 4 });
    assert.deepEqual(out, { vin: "V", nested: [{ x: 1 }], daysOnLot: 4 });
  });
});

describe("GET /api/lightsail?action=vehicles — dates are admin-only", () => {
  const saved = { ip: env.LIGHTSAIL_IP, host: env.LIGHTSAIL_HOST, key: env.LIGHTSAIL_API_KEY, dump: env.LIGHTSAIL_DUMP_SECRET };
  const realFetch = globalThis.fetch;
  let n = 0;
  const req = (headers: Record<string, string> = {}) => new Request("https://www.trimscout.com/api/lightsail?action=vehicles&pageSize=10", { headers: { "x-forwarded-for": `203.0.113.${(n = (n % 250) + 1)}`, ...headers } });
  beforeEach(() => { delete env.LIGHTSAIL_IP; delete env.LIGHTSAIL_HOST; delete env.LIGHTSAIL_API_KEY; env.LIGHTSAIL_DUMP_SECRET = "test-dump-secret-value"; globalThis.fetch = (async () => { throw new Error("no network in tests"); }) as typeof fetch; });
  afterEach(() => { globalThis.fetch = realFetch; for (const [k, v] of [["LIGHTSAIL_IP", saved.ip], ["LIGHTSAIL_HOST", saved.host], ["LIGHTSAIL_API_KEY", saved.key], ["LIGHTSAIL_DUMP_SECRET", saved.dump]] as const) { if (v === undefined) delete env[k]; else env[k] = v; } });

  it("a public caller's rows have no seen keys; the secret holder's still do", async () => {
    const pub = await (await GET(req())).json();
    assert.ok(pub.vehicles.length > 0);
    assert.deepEqual(keysOf(pub).filter((k) => SEEN_KEY.test(k)), []);
    const full = await (await GET(req({ [LIGHTSAIL_SECRET_HEADER]: "test-dump-secret-value" }))).json();
    assert.ok(keysOf(full).some((k) => SEEN_KEY.test(k)), "the full tier keeps its dates");
  });
});

describe("public pages never print First seen / Last seen", () => {
  const walk = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p) : /\.tsx$/.test(e.name) ? [p] : [];
  });
  const publicFiles = [...walk("app"), ...walk("components")].filter((f) => !/^(app|components)[\\/]admin[\\/]/.test(f) && !/\.test\.tsx$/.test(f));
  it("no non-admin page or component mentions a crawl date label", () => {
    assert.ok(publicFiles.length > 50);
    const hits = publicFiles.filter((f) => /(first|last)[ _]?seen/i.test(fs.readFileSync(f, "utf8")));
    assert.deepEqual(hits, []);
  });
});
