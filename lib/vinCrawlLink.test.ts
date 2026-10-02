import "./testdata/blockLiveHttp";
import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { crawlLinkForVin, crawlLinkFromListings, clearVinCrawlLinkCache } from "./vinCrawlLink";
import type { InventoryVehicle } from "./inventoryApi";

const VIN = "1GCPTEEK2T1275770";
const L = (o: Partial<InventoryVehicle>) => ({ vin: VIN, removedAt: null, lastSeenAt: "2026-10-01T00:00:00Z", vdpUrl: null, ...o }) as InventoryVehicle;

describe("crawlLinkFromListings", () => {
  it("prefers an in-stock listing, then the most recently seen, and skips rows with no usable URL", () => {
    assert.equal(crawlLinkFromListings([L({ vdpUrl: "https://a.example/sold", removedAt: "2026-09-30T00:00:00Z", lastSeenAt: "2026-09-30T00:00:00Z" }), L({ vdpUrl: "https://b.example/live" }), L({ vdpUrl: null, lastSeenAt: "2026-10-02T00:00:00Z" })]), "https://b.example/live");
    assert.equal(crawlLinkFromListings([L({ vdpUrl: "https://a.example/sold", removedAt: "2026-09-30T00:00:00Z" })]), "https://a.example/sold", "a sold car still links to what we crawled");
    assert.equal(crawlLinkFromListings([L({ vdpUrl: "javascript:alert(1)" }), L({})]), null);
    assert.equal(crawlLinkFromListings([]), null);
  });
});

describe("crawlLinkForVin", () => {
  beforeEach(() => clearVinCrawlLinkCache());

  it("finds the link, and serves a repeat from cache without a second lookup", async () => {
    let calls = 0;
    const lookup = async () => { calls++; return { vin: VIN, listings: [L({ vdpUrl: "https://x.example/v" })], days: [] }; };
    assert.deepEqual(await crawlLinkForVin(VIN, lookup as never), { status: "found", url: "https://x.example/v" });
    assert.deepEqual(await crawlLinkForVin(VIN.toLowerCase(), lookup as never), { status: "found", url: "https://x.example/v" });
    assert.equal(calls, 1);
  });

  it("a backend error is 'unavailable' (retry), never cached as 'no data'; a real empty answer is 'none'", async () => {
    let fail = true;
    const lookup = async () => { if (fail) throw new Error("box slow"); return { vin: VIN, listings: [], days: [] }; };
    assert.deepEqual(await crawlLinkForVin(VIN, lookup as never), { status: "unavailable" });
    fail = false;
    assert.deepEqual(await crawlLinkForVin(VIN, lookup as never), { status: "none" });
  });

  it("rejects a malformed VIN without calling the box", async () => {
    let calls = 0;
    assert.deepEqual(await crawlLinkForVin("nope", (async () => { calls++; return null; }) as never), { status: "none" });
    assert.equal(calls, 0);
  });
});
