import "./testdata/blockLiveHttp";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import {
  LISTING_DETAILS_UNAVAILABLE,
  FORD_LISTINGS_LOAD_FAILED,
  FORD_LISTINGS_RATE_LIMIT,
} from "./fordCompetitionUi";
import {
  MARKETCHECK_SHOPPER_ATTRIBUTION,
  MAX_SHOPPER_PRICE_HISTORY,
  currentDealerForVin,
  fetchShopperListingSheets,
  mapShopperPriceHistory,
  normalizeListingVins,
  publicListingSheets,
  shopperSheetFromMarketCheckPayloads,
} from "./listingSheet";

const FAVORITE = "1FMWK8JCXTGB47204";
const OTHER = "1FMWK8JC7TGB81309";
const THIRD = "1FMWK8JC1TGB69561";
const FOURTH = "1FMWK8JC7TGA20216";

function listingPayload(vin: string) {
  return {
    id: `lst-${vin.slice(-4)}`,
    vin,
    price: 58372,
    msrp: 64705,
    price_change: -500,
    miles: 12,
    stock_no: "T26012",
    inventory_type: "new",
    exterior_color: "Star White",
    interior_color: "Black Onyx",
    in_transit: false,
    first_seen_at_date: "2026-03-01",
    last_seen_at_date: "2026-08-20",
    dom: 40,
    dom_active: 18,
    vdp_url: "https://www.jimshorkey.com/new-ford/" + vin,
    data_source: "marketcheck_internal",
    extra: { inventory_type: "new" },
    dealer: {
      id: 44002,
      name: "Jim Shorkey Ford",
      street: "123 Dealer Rd",
      city: "White Oak",
      state: "PA",
      zip: "15131",
      phone: "412-555-0100",
      email: "sales@example.com",
    },
    media: { photo_links: ["https://cdn.example.com/car.jpg"] },
  };
}

describe("listing sheet mapping", () => {
  it("caps to 3 unique 17-character VINs and drops junk", () => {
    assert.deepEqual(
      normalizeListingVins([FAVORITE.toLowerCase(), OTHER, OTHER, "short", FOURTH, THIRD]),
      [FAVORITE, OTHER, FOURTH]
    );
  });

  it("names a Porsche's doubled paint code, and leaves every other make's color alone", () => {
    const porsche = "WP1AA2A53TLB07942";
    const sheet = shopperSheetFromMarketCheckPayloads({
      vin: porsche,
      searchListing: { ...listingPayload(porsche), exterior_color: "0q0q" },
    });
    assert.equal(sheet.exteriorColor, "White");
    const ford = shopperSheetFromMarketCheckPayloads({
      vin: OTHER,
      searchListing: { ...listingPayload(OTHER), exterior_color: "0q0q" },
    });
    assert.equal(ford.exteriorColor, "0q0q");
  });

  it("maps shopper-useful fields and omits internal ids, data_source, and dealer email", () => {
    const sheet = shopperSheetFromMarketCheckPayloads({
      vin: OTHER,
      searchListing: listingPayload(OTHER),
      history: {
        listings: [
          { price: 58872, first_seen_at_date: "2026-03-01" },
          { price: 58372, first_seen_at_date: "2026-08-12" },
        ],
      },
    });
    assert.equal(sheet.available, true);
    assert.equal(sheet.attribution, MARKETCHECK_SHOPPER_ATTRIBUTION);
    assert.equal(sheet.advertisedPrice, 58372);
    assert.equal(sheet.msrp, 64705);
    assert.equal(sheet.priceChange, -500);
    assert.deepEqual(sheet.priceHistory, [
      { date: "2026-03-01", price: 58872, change: null },
      { date: "2026-08-12", price: 58372, change: -500 },
    ]);
    assert.equal(sheet.daysOnMarket, 40);
    assert.equal(sheet.daysOnMarketActive, 18);
    assert.equal(sheet.firstSeen, "2026-03-01");
    assert.equal(sheet.lastSeen, "2026-08-20");
    assert.equal(sheet.stockNumber, "T26012");
    assert.equal(sheet.inventoryType, "new");
    assert.equal(sheet.exteriorColor, "Star White");
    assert.equal(sheet.interiorColor, "Black Onyx");
    assert.equal(sheet.mileage, 12);
    assert.equal(sheet.dealerName, "Jim Shorkey Ford");
    assert.equal(sheet.dealerCity, "White Oak");
    assert.equal(sheet.dealerPhone, "412-555-0100");
    assert.equal(sheet.vdpUrl, "https://www.jimshorkey.com/new-ford/" + OTHER);
    assert.equal(sheet.photoUrl, "https://cdn.example.com/car.jpg");
    assert.equal(sheet.note, null);
    const json = JSON.stringify(publicListingSheets([sheet]));
    assert.doesNotMatch(json, /data_source/);
    assert.doesNotMatch(json, /sales@example\.com/);
    assert.doesNotMatch(json, /lst-/);
    assert.doesNotMatch(json, /api_key/);
    assert.match(json, /Data powered by MarketCheck/);
  });

  it("empty listing is generic unavailable with no vendor name or attribution", () => {
    const sheet = shopperSheetFromMarketCheckPayloads({ vin: FAVORITE, searchListing: null });
    assert.equal(sheet.available, false);
    assert.equal(sheet.attribution, null);
    assert.equal(sheet.note, LISTING_DETAILS_UNAVAILABLE);
    assert.deepEqual(sheet.priceHistory, []);
    assert.doesNotMatch(sheet.note || "", /marketcheck|auto\.dev/i);
  });

  it("computes price change vs prior history when listing has no price_change", () => {
    const row = listingPayload(OTHER);
    delete (row as { price_change?: number }).price_change;
    const sheet = shopperSheetFromMarketCheckPayloads({
      vin: OTHER,
      searchListing: row,
      history: { listings: [{ price: 58372 }, { price: 56000 }] },
    });
    assert.equal(sheet.priceChange, 2372);
    assert.deepEqual(sheet.priceHistory, []);
  });
});

describe("dated shopper price history", () => {
  it("maps chronological distinct prices with change vs previous and includes them in public sheets", () => {
    const history = {
      listings: [
        { price: 49990, first_seen_at_date: "2026-08-12" },
        { price: 49990, first_seen_at_date: "2026-08-20" },
        { price: 50990, first_seen_at_date: "2026-03-01" },
        { price: 50990, last_seen_at_date: "2026-04-01" },
      ],
    };
    const mapped = mapShopperPriceHistory(history);
    assert.deepEqual(mapped, [
      { date: "2026-03-01", price: 50990, change: null },
      { date: "2026-08-12", price: 49990, change: -1000 },
    ]);
    const sheet = shopperSheetFromMarketCheckPayloads({
      vin: OTHER,
      searchListing: listingPayload(OTHER),
      history,
      listingDetail: { ...listingPayload(OTHER), ref_price: 51990, ref_price_dt: "2026-01-15" },
    });
    assert.deepEqual(sheet.priceHistory, [
      { date: "2026-01-15", price: 51990, change: null },
      { date: "2026-03-01", price: 50990, change: -1000 },
      { date: "2026-08-12", price: 49990, change: -1000 },
    ]);
    const json = JSON.stringify(publicListingSheets([sheet]));
    assert.match(json, /"priceHistory"/);
    assert.match(json, /2026-08-12/);
    assert.doesNotMatch(json, /data_source/);
    assert.doesNotMatch(json, /ref_price/);
    assert.doesNotMatch(json, /first_seen_at_date/);
    assert.match(json, /Data powered by MarketCheck/);
  });

  it("dedupes consecutive identical prices, caps to the last N, and omits undated rows", () => {
    const listings = [];
    for (let i = 0; i < 14; i++) {
      listings.push({
        price: 40000 + i * 100,
        first_seen_at_date: `2026-01-${String(i + 1).padStart(2, "0")}`,
      });
      listings.push({
        price: 40000 + i * 100,
        first_seen_at_date: `2026-01-${String(i + 1).padStart(2, "0")}`,
      });
    }
    listings.push({ price: 99999 });
    const mapped = mapShopperPriceHistory({ listings });
    assert.equal(mapped.length, MAX_SHOPPER_PRICE_HISTORY);
    assert.equal(mapped[0].date, "2026-01-05");
    assert.equal(mapped[0].price, 40400);
    assert.equal(mapped[mapped.length - 1].date, "2026-01-14");
    assert.equal(mapped[mapped.length - 1].price, 41300);
    assert.equal(mapped[mapped.length - 1].change, 100);
    assert.equal(
      mapShopperPriceHistory({ listings: [{ price: 50000 }, { price: 49000 }] }).length,
      0
    );
  });
});

describe("fetchShopperListingSheets mocks HTTP", () => {
  it("calls VIN search + history and optional listing detail, never YMM hunt", async () => {
    const urls: string[] = [];
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = String(input);
      urls.push(url);
      const parsed = new URL(url);
      assert.equal(parsed.searchParams.get("append_api_key"), "false");
      if (parsed.pathname === "/v2/search/car/active") {
        assert.equal(parsed.searchParams.get("vin"), OTHER);
        assert.equal(parsed.searchParams.has("make"), false);
        assert.equal(parsed.searchParams.has("model"), false);
        return new Response(JSON.stringify({ listings: [listingPayload(OTHER)] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (parsed.pathname === `/v2/history/car/${OTHER}`) {
        return new Response(JSON.stringify({ listings: [{ price: 58872 }] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (parsed.pathname === `/v2/listing/car/lst-${OTHER.slice(-4)}`) {
        return new Response(JSON.stringify(listingPayload(OTHER)), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      throw new Error(`unexpected URL ${url}`);
    }) as typeof fetch;

    const sheets = await fetchShopperListingSheets([OTHER], {
      apiKey: "test-key",
      fetchImpl,
    });
    assert.equal(sheets.length, 1);
    assert.equal(sheets[0].available, true);
    assert.equal(sheets[0].advertisedPrice, 58372);
    assert.ok(urls.some((u) => u.includes("/v2/search/car/active")));
    assert.ok(urls.some((u) => u.includes(`/v2/history/car/${OTHER}`)));
    assert.ok(urls.some((u) => u.includes("/v2/listing/car/")));
    assert.equal(
      urls.every((u) => !u.includes("year=") && !u.includes("make=") && !u.includes("model=")),
      true
    );
    for (const sheet of publicListingSheets(sheets)) {
      assert.equal(sheet.attribution, MARKETCHECK_SHOPPER_ATTRIBUTION);
    }
  });

  it("no MarketCheck key returns generic unavailable without fetching", async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      throw new Error("should not fetch");
    }) as typeof fetch;
    const sheets = await fetchShopperListingSheets([FAVORITE, OTHER], { apiKey: null, fetchImpl });
    assert.equal(calls, 0);
    assert.equal(sheets.length, 2);
    assert.equal(sheets[0].available, false);
    assert.equal(sheets[0].note, LISTING_DETAILS_UNAVAILABLE);
    assert.doesNotMatch(sheets[0].note || "", /marketcheck/i);
    assert.equal(sheets[0].attribution, null);
  });

  it("HTTP 429 maps to generic rate-limit copy without vendor names", async () => {
    const fetchImpl = (async () =>
      new Response(JSON.stringify({ message: "quota exceeded" }), { status: 429 })) as typeof fetch;
    const sheets = await fetchShopperListingSheets([FAVORITE], { apiKey: "test-key", fetchImpl });
    assert.equal(sheets[0].available, false);
    assert.equal(sheets[0].note, FORD_LISTINGS_RATE_LIMIT);
    assert.doesNotMatch(sheets[0].note || "", /marketcheck|auto\.dev/i);
    assert.equal(sheets[0].attribution, null);
  });

  it("empty search listings is Listing details unavailable, not a vendor name", async () => {
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/v2/search/car/active")) {
        return new Response(JSON.stringify({ num_found: 0, listings: [] }), { status: 200 });
      }
      return new Response(JSON.stringify({ listings: [] }), { status: 200 });
    }) as typeof fetch;
    const sheets = await fetchShopperListingSheets([FAVORITE], { apiKey: "test-key", fetchImpl });
    assert.equal(sheets[0].note, LISTING_DETAILS_UNAVAILABLE);
    assert.equal(sheets[0].attribution, null);
  });
});

describe("currentDealerForVin — who currently has this VIN listed", () => {
  it("makes exactly one search-only call and returns the live dealer, never history or listing detail", async () => {
    const urls: string[] = [];
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = String(input);
      urls.push(url);
      const parsed = new URL(url);
      if (parsed.pathname === "/v2/search/car/active") {
        assert.equal(parsed.searchParams.get("vin"), OTHER);
        return new Response(JSON.stringify({ listings: [listingPayload(OTHER)] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      throw new Error(`unexpected URL ${url}`);
    }) as typeof fetch;

    const dealer = await currentDealerForVin(OTHER, { apiKey: "test-key", fetchImpl });
    assert.equal(urls.length, 1, "exactly one call — no history, no listing detail");
    assert.ok(urls[0].includes("/v2/search/car/active"));
    assert.equal(dealer?.dealerName, "Jim Shorkey Ford");
    assert.equal(dealer?.dealerStreet, "123 Dealer Rd");
    assert.equal(dealer?.dealerCity, "White Oak");
    assert.equal(dealer?.dealerState, "PA");
    assert.equal(dealer?.dealerZip, "15131");
    assert.equal(dealer?.dealerPhone, "412-555-0100");
    assert.equal(dealer?.vdpUrl, "https://www.jimshorkey.com/new-ford/" + OTHER);
  });

  it("returns null without a key, without a listing, or on a non-17-char VIN — never throws", async () => {
    let calls = 0;
    const countingFetch = (async () => {
      calls += 1;
      throw new Error("should not fetch");
    }) as typeof fetch;
    assert.equal(await currentDealerForVin(OTHER, { apiKey: null, fetchImpl: countingFetch }), null);
    assert.equal(calls, 0, "no key means no call at all");

    const emptyFetch = (async () =>
      new Response(JSON.stringify({ num_found: 0, listings: [] }), { status: 200 })) as typeof fetch;
    assert.equal(await currentDealerForVin(OTHER, { apiKey: "test-key", fetchImpl: emptyFetch }), null);

    const failFetch = (async () => new Response("nope", { status: 503 })) as typeof fetch;
    assert.equal(await currentDealerForVin(OTHER, { apiKey: "test-key", fetchImpl: failFetch }), null);

    assert.equal(await currentDealerForVin("short", { apiKey: "test-key", fetchImpl: countingFetch }), null);

    const throwingFetch = (async () => {
      throw new Error("network down");
    }) as typeof fetch;
    assert.equal(await currentDealerForVin(OTHER, { apiKey: "test-key", fetchImpl: throwingFetch }), null);
  });

  it("treats a listing with no dealer name as a miss, not a partial result", async () => {
    const fetchImpl = (async () =>
      new Response(
        JSON.stringify({ listings: [{ ...listingPayload(OTHER), dealer: { city: "White Oak" } }] }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )) as typeof fetch;
    assert.equal(await currentDealerForVin(OTHER, { apiKey: "test-key", fetchImpl }), null);
  });
});

describe("listing-facts route and compare page copy", () => {
  it("route maps sheets and does not re-run the coarse hunt or cache listings", () => {
    const src = fs.readFileSync(path.join(process.cwd(), "app/api/listing-facts/route.ts"), "utf8");
    assert.match(src, /fetchShopperListingSheets/);
    assert.match(src, /publicListingSheets/);
    assert.doesNotMatch(src, /findSimilarFordVehicles/);
    assert.doesNotMatch(src, /searchCoarseListings/);
    assert.doesNotMatch(src, /redis/i);
    assert.doesNotMatch(src, /ford-comparables/);
    assert.match(src, /FORD_LISTINGS_LOAD_FAILED/);
    assert.doesNotMatch(src, /MarketCheck listings HTTP/);
  });

  it("compare UI never pads demo Explorers/Porsches and hides vendor names on empty/error", () => {
    const page = fs.readFileSync(path.join(process.cwd(), "app/compare/page.tsx"), "utf8");
    const view = fs.readFileSync(path.join(process.cwd(), "components/OfferCompareView.tsx"), "utf8");
    const wizard = fs.readFileSync(path.join(process.cwd(), "components/BiddingWizard.tsx"), "utf8");
    assert.match(page, /OfferCompareView/);
    assert.match(view, /Compare vehicles in this deal/);
    assert.match(view, /LISTING_DETAILS_UNAVAILABLE/);
    assert.match(view, /sanitizeShopperListingsCopy/);
    assert.match(view, /FORD_LISTINGS_LOAD_FAILED/);
    assert.match(view, /sheet\.attribution/);
    assert.match(view, /Terms for this VIN/);
    assert.match(view, /vehicle and dealer fees only/);
    assert.match(view, /Registration fees and[\s\S]*taxes are calculated after the deal is accepted/);
    assert.match(view, /trade-in[\s\S]{0,80}separate step/i);
    assert.match(view, /Estimated monthly/);
    assert.match(view, /Estimate only/);
    assert.match(view, /FORD_COMPETITION_FACTORY_OPTIONS/);
    assert.match(view, /sharedFactoryOptionKeys/);
    assert.match(view, /isSharedFactoryOption/);
    assert.match(view, /Price history/);
    assert.match(view, /formatPriceHistoryLine/);
    assert.doesNotMatch(view, /vs prior/);
    const termsAt = view.indexOf("Terms for this VIN");
    const factoryAt = view.indexOf("{FORD_COMPETITION_FACTORY_OPTIONS}");
    const listingAt = view.indexOf("Listing details");
    assert.ok(termsAt >= 0 && factoryAt > termsAt && listingAt > termsAt);
    assert.doesNotMatch(view, /call dealer/i);
    assert.doesNotMatch(view, /window sticker/i);
    assert.doesNotMatch(view, /Porsche 911/);
    assert.doesNotMatch(view, /BMW 3 Series/);
    assert.doesNotMatch(view, /DEMO_COMPARABLE_LISTINGS/);
    assert.doesNotMatch(view, /MarketCheck/);
    assert.doesNotMatch(view, /Auto\.dev/);
    assert.doesNotMatch(view, /Finding matching lots/);
    assert.match(view, /\/api\/listing-facts/);
    // The compare page's one comparable-vehicle search call — by year/make/
    // model/trim, no per-VIN sticker fetch — never the expensive per-OEM
    // hunt or a persisted deal-search endpoint.
    assert.match(view, /\/api\/manual-comparables/);
    assert.doesNotMatch(view, /\/api\/compare-deal/);
    assert.doesNotMatch(view, /findSimilarFordVehicles/);
    // The one search's full result set is the competing-vehicles list; the
    // buyer checks two of them and those two are written into the deal
    // (replaceCompetitorLots), so the tracker sees the same picks. Nothing
    // is pasted in by hand, and the list itself is never persisted
    // (listings-provider terms) — only the two chosen vehicles are.
    assert.match(view, /Competing vehicles/);
    assert.match(view, /CompetingVehiclesPanel/);
    assert.match(view, /type="checkbox"/);
    assert.match(view, /replaceCompetitorLots/);
    assert.match(view, /vehicleFromComparableSuggestion/);
    assert.match(view, /VehicleHeroCard/);
    assert.match(view, /Deal terms &amp; factory options/);
    assert.doesNotMatch(view, /importPastedFactoryVehicle/);
    assert.doesNotMatch(view, /Already know one\?/);
    assert.doesNotMatch(view, /saveOfferCompareSnapshot\([^)]*candidates/);
    assert.match(view, /border-2 border-emerald-500/);
    assert.match(wizard, /router\.push\("\/compare"\)/);
    assert.match(wizard, /buildOfferCompareSnapshot/);
    assert.match(wizard, /otherLots: otherLotsForDeal/);
    assert.match(wizard, /vehicleTerms: vehicleTermsForDeal/);
    assert.match(wizard, /TOTAL_STEPS = 3/);
    assert.match(wizard, /STEP 3: REVIEW/);
    assert.match(wizard, /Step 3: Review & Privacy Shield/);
    assert.match(wizard, /huntZip/);
    assert.match(wizard, /Your ZIP/);
    assert.match(wizard, /Radius miles/);
    assert.doesNotMatch(wizard, /Set Your Deal Parameters/);
    assert.doesNotMatch(wizard, /Buyer Zip Code/);
    assert.doesNotMatch(wizard, /Dealer Radius/);
    assert.doesNotMatch(wizard, /\/api\/ford-comparables/);
    assert.match(wizard, /They do not search listings/);
    assert.doesNotMatch(wizard, /STEP 6:/);
  });

  it("generic load-failed copy is reused", () => {
    assert.equal(FORD_LISTINGS_LOAD_FAILED.includes("MarketCheck"), false);
    assert.doesNotMatch(LISTING_DETAILS_UNAVAILABLE, /marketcheck|auto\.dev/i);
  });
});
