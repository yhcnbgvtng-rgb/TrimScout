import "../testdata/blockLiveHttp";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { scrapeDealerDotCom } from "./dealerDotComScraper";
import { scrapeDealerInspire } from "./dealerInspireScraper";
import { scrapeDealerOn } from "./dealerOnScraper";
import { scrapeOemAllocationFeed } from "./oemInventoryScraper";
import { runUnifiedScrapers } from "./index";

async function withMockedFetch<T>(
  impl: typeof fetch,
  run: () => Promise<T>
): Promise<T> {
  const orig = globalThis.fetch;
  globalThis.fetch = impl;
  try {
    return await run();
  } finally {
    globalThis.fetch = orig;
  }
}

const NETWORK_FAILURE: typeof fetch = (async () => {
  throw new Error("simulated network failure");
}) as typeof fetch;

const EMPTY_RESULTS: typeof fetch = (async () =>
  new Response(JSON.stringify({ results: [] }), { status: 200 })) as typeof fetch;

const BLOCKED: typeof fetch = (async () =>
  new Response("Access Denied", { status: 403 })) as typeof fetch;

describe("CMS scrapers never fabricate a vehicle on a failed/empty live scrape", () => {
  it("Dealer.com: network failure yields zero vehicles, not an invented BMW", async () => {
    const result = await withMockedFetch(NETWORK_FAILURE, () =>
      scrapeDealerDotCom("bmwofsanrafael.com", { make: "BMW", model: "3 Series", zip: "94107" })
    );
    assert.deepEqual(result.vehicles, []);
    assert.equal(result.totalFound, 0);
  });

  it("Dealer.com: an empty parsed results array yields zero vehicles", async () => {
    const result = await withMockedFetch(EMPTY_RESULTS, () =>
      scrapeDealerDotCom("bmwofsanrafael.com", { zip: "94107" })
    );
    assert.deepEqual(result.vehicles, []);
  });

  it("Dealer.com: a 403/blocked response yields zero vehicles", async () => {
    const result = await withMockedFetch(BLOCKED, () =>
      scrapeDealerDotCom("bmwofsanrafael.com", { zip: "94107" })
    );
    assert.deepEqual(result.vehicles, []);
  });

  it("Dealer.com: a real item without a VIN is skipped rather than assigned a fabricated one", async () => {
    const fetchImpl: typeof fetch = (async () =>
      new Response(JSON.stringify({ results: [{ make: "BMW", model: "330i" }] }), { status: 200 })) as typeof fetch;
    const result = await withMockedFetch(fetchImpl, () =>
      scrapeDealerDotCom("bmwofsanrafael.com", { zip: "94107" })
    );
    assert.deepEqual(result.vehicles, []);
  });

  it("Dealer.com: a real item with a real VIN is kept, using that VIN verbatim", async () => {
    const fetchImpl: typeof fetch = (async () =>
      new Response(JSON.stringify({ results: [{ vin: "WBA5R7C50PFH12345", make: "BMW", model: "330i" }] }), { status: 200 })) as typeof fetch;
    const result = await withMockedFetch(fetchImpl, () =>
      scrapeDealerDotCom("bmwofsanrafael.com", { zip: "94107" })
    );
    assert.equal(result.vehicles.length, 1);
    assert.equal(result.vehicles[0].vin, "WBA5R7C50PFH12345");
  });

  it("DealerInspire: network failure yields zero vehicles, not an invented Hyundai", async () => {
    const result = await withMockedFetch(NETWORK_FAILURE, () =>
      scrapeDealerInspire("vallejohyundai.com", { zip: "94590" })
    );
    assert.deepEqual(result.vehicles, []);
    assert.equal(result.totalFound, 0);
  });

  it("DealerInspire: a real item without a VIN is skipped", async () => {
    const fetchImpl: typeof fetch = (async () =>
      new Response(JSON.stringify({ vehicles: [{ make: "Hyundai", model: "Ioniq 5" }] }), { status: 200 })) as typeof fetch;
    const result = await withMockedFetch(fetchImpl, () =>
      scrapeDealerInspire("vallejohyundai.com", { zip: "94590" })
    );
    assert.deepEqual(result.vehicles, []);
  });

  it("DealerOn: network failure yields zero vehicles, not an invented Kia", async () => {
    const result = await withMockedFetch(NETWORK_FAILURE, () =>
      scrapeDealerOn("hilltopford.com", { zip: "94533" })
    );
    assert.deepEqual(result.vehicles, []);
    assert.equal(result.totalFound, 0);
  });

  it("DealerOn: a real item without a VIN is skipped", async () => {
    const fetchImpl: typeof fetch = (async () =>
      new Response(JSON.stringify({ vehicles: [{ make: "Ford", model: "F-150 Lightning" }] }), { status: 200 })) as typeof fetch;
    const result = await withMockedFetch(fetchImpl, () =>
      scrapeDealerOn("hilltopford.com", { zip: "94533" })
    );
    assert.deepEqual(result.vehicles, []);
  });
});

describe("scrapeOemAllocationFeed has no real feed, so it never fabricates inventory", () => {
  it("always returns zero vehicles regardless of make", async () => {
    for (const make of ["Toyota", "BMW", "Porsche", "Ford", "SomeUnknownMake"]) {
      const result = await scrapeOemAllocationFeed({ make, zip: "94107" });
      assert.deepEqual(result.vehicles, []);
      assert.equal(result.totalFound, 0);
    }
  });
});

describe("runUnifiedScrapers", () => {
  it("degrades to zero scraped vehicles (not fabricated ones) when every live dealer site is unreachable", async () => {
    const result = await withMockedFetch(NETWORK_FAILURE, () =>
      runUnifiedScrapers({ zip: "94107", make: "BMW" })
    );
    // porscheFinderScraper is out of scope for this fix and may still add
    // its own (unrelated) results; assert on the four in-scope engines only.
    assert.deepEqual(result.engineBreakdown.dealerDotCom, { count: 0, status: "success", timeMs: result.engineBreakdown.dealerDotCom.timeMs });
    assert.deepEqual(result.engineBreakdown.dealerInspire, { count: 0, status: "success", timeMs: result.engineBreakdown.dealerInspire.timeMs });
    assert.deepEqual(result.engineBreakdown.dealerOn, { count: 0, status: "success", timeMs: result.engineBreakdown.dealerOn.timeMs });
    assert.deepEqual(result.engineBreakdown.oemAllocations, { count: 0, status: "success", timeMs: result.engineBreakdown.oemAllocations.timeMs });
    for (const v of result.vehicles) {
      assert.notEqual(v.dealerUrl?.includes("bmwofsanrafael.com"), true, "no synthetic Dealer.com fallback vehicle should appear");
    }
  });
});
