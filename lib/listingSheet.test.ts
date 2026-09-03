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
    assert.match(view, /Estimated monthly/);
    assert.match(view, /Estimate only/);
    assert.match(view, /FORD_COMPETITION_FACTORY_OPTIONS/);
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
    // The compare page is the one legitimate caller of the free comparable-
    // vehicle search — it must call the route, but never the expensive hunt
    // or a persisted deal-search endpoint.
    assert.match(view, /\/api\/ford-comparables/);
    assert.doesNotMatch(view, /\/api\/compare-deal/);
    assert.doesNotMatch(view, /findSimilarFordVehicles/);
    assert.match(view, /importPastedFactoryVehicle/);
    assert.match(view, /assignCompetitorLot/);
    assert.match(view, /vehicleFromComparableSuggestion/);
    assert.match(view, /Find comparable vehicles/);
    assert.match(view, /border-2 border-emerald-500/);
    assert.match(view, /grid-cols-1 md:grid-cols-2 xl:grid-cols-3/);
    assert.match(view, /COMPARE_COLUMN_ROLES/);
    assert.match(view, /Add a competitor/);
    assert.match(view, /Paste a VIN or dealer listing URL/);
    assert.match(wizard, /router\.push\("\/compare"\)/);
    assert.match(wizard, /buildOfferCompareSnapshot/);
    assert.match(wizard, /otherLots: otherLotsForDeal/);
    assert.match(wizard, /vehicleTerms: vehicleTermsForDeal/);
    assert.match(wizard, /TOTAL_STEPS = 5/);
    assert.match(wizard, /STEP 5: REVIEW/);
    assert.match(wizard, /Step 5: Review & Privacy Shield/);
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
