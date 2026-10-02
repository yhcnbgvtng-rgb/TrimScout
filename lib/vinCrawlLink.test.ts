import "./testdata/blockLiveHttp";
import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { crawlDataForVin, clearVinCrawlCache, crawlSheetPathForVin } from "./vinCrawlLink";

const VIN = "1GCPTEEK2T1275770";
const withListings = (n: number) => async () => ({ vin: VIN, listings: Array.from({ length: n }, () => ({})), days: [] }) as never;

describe("crawlDataForVin", () => {
  beforeEach(() => clearVinCrawlCache());

  it("found when the crawl has any listing for the VIN (a sold car still has crawl history), cached on repeat", async () => {
    let calls = 0;
    const lookup = (async () => { calls++; return { vin: VIN, listings: [{ removedAt: "2026-09-30" }], days: [] }; }) as never;
    assert.equal(await crawlDataForVin(VIN, lookup), "found");
    assert.equal(await crawlDataForVin(VIN.toLowerCase(), lookup), "found");
    assert.equal(calls, 1);
  });

  it("none when the crawl has never seen it", async () => {
    assert.equal(await crawlDataForVin(VIN, withListings(0)), "none");
  });

  it("a backend error is 'unavailable' (retry), never cached as 'no data'", async () => {
    assert.equal(await crawlDataForVin(VIN, (async () => { throw new Error("box slow"); }) as never), "unavailable");
    assert.equal(await crawlDataForVin(VIN, withListings(2)), "found");
  });

  it("rejects a malformed VIN without calling the box", async () => {
    let calls = 0;
    assert.equal(await crawlDataForVin("nope", (async () => { calls++; return null; }) as never), "none");
    assert.equal(calls, 0);
  });
});

describe("crawlSheetPathForVin", () => {
  it("points at the admin crawl sheet for that VIN", () => {
    assert.equal(crawlSheetPathForVin(" 1gcpteek2t1275770 "), "/admin/crawl?vin=1GCPTEEK2T1275770");
  });
});
