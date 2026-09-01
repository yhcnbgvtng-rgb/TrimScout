import "./testdata/blockLiveHttp";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { formatDealStructures } from "./dealStructure";
import { reviewTargetFromVehicle } from "./fordCompetitionUi";
import {
  mapDealRequestJson,
  offerPathLabel,
  shopperDealStructurePayload,
} from "./shopperDeal";

const SUBJECT = "1FMWK8JCXTGB47204";

const importedVehicle = {
  dealerUrl: "https://www.example.com/ford/vdp-a",
  location: {
    dealerName: "Battlefield Ford",
    city: "Killeen",
    state: "TX",
    zip: "76541",
    distanceMiles: 0,
  },
};

describe("shopper deal snapshot persists onto the deal request", () => {
  it("stores dealer, offer path, and payment methods in dealStructure JSON", () => {
    const payload = shopperDealStructurePayload({
      requestedStructures: ["cash", "finance"],
      financeTermMonths: 60,
      downPayment: 5000,
      leaseMileagePerYear: 12000,
      leaseTermMonths: 36,
      directOffer: true,
      vehicle: importedVehicle,
      mustHavePackages: ["Ultimate Package"],
    });
    assert.equal(payload.directOffer, true);
    assert.deepEqual(payload.requestedStructures, ["cash", "finance"]);
    assert.equal(payload.dealerName, "Battlefield Ford");
    assert.equal(payload.dealerCity, "Killeen");
    assert.equal(payload.dealerState, "TX");
    assert.equal(payload.dealerZip, "76541");
    assert.equal(payload.dealerUrl, "https://www.example.com/ford/vdp-a");
    assert.deepEqual(payload.mustHavePackages, ["Ultimate Package"]);
    assert.equal("otherLots" in payload, false);
  });

  it("stores other lots and per-VIN terms when present — never pads a third car", () => {
    const other = {
      id: "ford-1FMWK8JC7TGB81309",
      vin: "1FMWK8JC7TGB81309",
      year: 2026,
      make: "Ford",
      model: "Explorer",
      trim: "Tremor",
      bodyType: "",
      engine: "",
      drivetrain: "",
      transmission: "",
      exteriorColor: "",
      interiorColor: "",
      msrp: 0,
      dealerPrice: 58372,
      daysOnLot: 0,
      status: "on_lot" as const,
      location: { dealerName: "Jim Shorkey Ford", city: "White Oak", state: "PA", zip: "15131", distanceMiles: 80 },
      packages: [],
      options: [],
      imageUrl: "",
      mileage: 0,
    };
    const payload = shopperDealStructurePayload({
      requestedStructures: ["cash"],
      financeTermMonths: 60,
      downPayment: 0,
      leaseMileagePerYear: 12000,
      leaseTermMonths: 36,
      directOffer: false,
      vehicle: importedVehicle,
      mustHavePackages: [],
      otherLots: [other],
      vehicleTerms: [
        { vin: SUBJECT, cash: { offerPrice: 61200 } },
        { vin: other.vin, cash: { offerPrice: 58372 } },
      ],
    });
    assert.equal(Array.isArray(payload.otherLots), true);
    assert.equal((payload.otherLots as unknown[]).length, 1);
    assert.equal((payload.vehicleTerms as { vin: string }[])[0].vin, SUBJECT);
    assert.equal((payload.vehicleTerms as { cash: { offerPrice: number } }[])[1].cash.offerPrice, 58372);
  });

  it("omits dealer fields when the imported vehicle has none — never invents a rooftop", () => {
    const payload = shopperDealStructurePayload({
      requestedStructures: ["cash"],
      financeTermMonths: 60,
      downPayment: 0,
      leaseMileagePerYear: 12000,
      leaseTermMonths: 36,
      directOffer: false,
      vehicle: { dealerUrl: undefined, location: { dealerName: "", city: "", state: "", distanceMiles: 0 } },
      mustHavePackages: [],
    });
    assert.equal("dealerName" in payload, false);
    assert.equal("dealerCity" in payload, false);
    assert.equal("dealerUrl" in payload, false);
  });

  it("maps a persisted API row into year/make/model/trim, VIN, dealer, payment, and path", () => {
    const mapped = mapDealRequestJson({
      id: "42",
      strategy: "firm_offer",
      referenceVin: SUBJECT,
      referenceYear: 2026,
      referenceMake: "Ford",
      referenceModel: "Explorer",
      referenceTrim: "ST",
      referencePrice: 61200,
      referenceMsrp: 64705,
      targetOtdPrice: 58000,
      paymentMethod: "cash",
      dealStructure: {
        requestedStructures: ["cash", "finance"],
        directOffer: true,
        dealerName: "Battlefield Ford",
        dealerCity: "Killeen",
        dealerState: "TX",
        dealerZip: "76541",
        dealerUrl: "https://www.example.com/ford/vdp-a",
        mustHavePackages: ["Ultimate Package"],
        otherLots: [
          {
            vin: "1FMWK8JC7TGB81309",
            year: 2026,
            make: "Ford",
            model: "Explorer",
            trim: "Tremor",
            dealerPrice: 58372,
            location: { dealerName: "Jim Shorkey Ford", city: "White Oak", state: "PA" },
          },
        ],
        vehicleTerms: [{ vin: SUBJECT, cash: { offerPrice: 60000 } }],
      },
      tradeIn: { hasTradeIn: true, year: 2020, make: "Honda", model: "CR-V", trim: "EX", mileage: 42000, condition: "good" },
      buyerZip: "76541",
      buyerState: "TX",
      searchRadiusMiles: 100,
      sameStateOnly: true,
      status: "active",
      createdAt: "2026-09-01T00:00:00Z",
      expiresAt: "2026-09-03T00:00:00Z",
    });
    assert.equal(mapped.id, "42");
    assert.equal(mapped.targetVin, SUBJECT);
    assert.equal(mapped.directOffer, true);
    assert.equal(offerPathLabel(mapped.directOffer), "Offer this dealer directly");
    assert.equal(formatDealStructures(mapped.dealStructurePreferences?.requestedStructures || []), "Cash + Finance");
    assert.equal(mapped.targetOtdPrice, 58000);
    assert.equal(mapped.tradeIn?.make, "Honda");
    assert.equal(mapped.flexibleCriteria?.mustHavePackages[0], "Ultimate Package");

    const review = reviewTargetFromVehicle(mapped.targetVehicle);
    assert.equal(review?.title, "2026 Ford Explorer ST");
    assert.equal(review?.vin, SUBJECT);
    assert.equal(review?.dealerName, "Battlefield Ford");
    assert.equal(review?.locationLine, "Killeen, TX 76541");
    assert.equal(review?.vdpHref, "https://www.example.com/ford/vdp-a");
    assert.notEqual(review?.title, "BMW 3 Series");
    assert.doesNotMatch(review?.title || "", /Porsche/i);
    assert.equal(mapped.otherLots?.length, 1);
    assert.equal(mapped.otherLots?.[0].vin, "1FMWK8JC7TGB81309");
    assert.equal(mapped.dealStructurePreferences?.vehicleTerms?.[0].cash?.offerPrice, 60000);
  });

  it("does not invent a BMW/Porsche or dealer when the API row has no vehicle", () => {
    const mapped = mapDealRequestJson({
      id: "7",
      strategy: "exact_auction",
      paymentMethod: "cash",
      buyerZip: "07405",
      status: "active",
    });
    assert.equal(mapped.targetVehicle, undefined);
    assert.equal(reviewTargetFromVehicle(mapped.targetVehicle), null);
    assert.equal(mapped.flexibleCriteria?.make, "");
    assert.equal(mapped.flexibleCriteria?.model, "");
    assert.notEqual(mapped.flexibleCriteria?.make, "BMW");
    assert.equal(mapped.directOffer, false);
    assert.equal(offerPathLabel(mapped.directOffer), "Get prices from other dealers");
    assert.equal(mapped.tradeIn, undefined);
  });
});

describe("Live Deal Room and tracker render the mapped imported deal", () => {
  it("wizard POST includes the shopper deal snapshot and mapper", () => {
    const wizard = fs.readFileSync(path.join(process.cwd(), "components/BiddingWizard.tsx"), "utf8");
    assert.match(wizard, /shopperDealStructurePayload/);
    assert.match(wizard, /mapDealRequestJson\(dr, local\)/);
    assert.match(wizard, /router\.push\("\/compare"\)/);
    assert.match(wizard, /directOffer: directOfferMode/);
    assert.match(wizard, /useState<boolean>\(false\)/);
    assert.match(wizard, /make: selectedVehicle\?\.make \|\| ""/);
    assert.doesNotMatch(wizard, /minMsrp: selectedVehicle \? Math\.round\(selectedVehicle\.msrp \* 0\.9\) : 45000/);
  });

  it("page maps GET /api/deal-requests through mapDealRequestJson and does not inject the demo BMW request", () => {
    const page = fs.readFileSync(path.join(process.cwd(), "app/page.tsx"), "utf8");
    assert.match(page, /import \{ mapDealRequestJson \} from "\.\.\/lib\/shopperDeal"/);
    assert.match(page, /requests=\{shopperRequests\}/);
    assert.doesNotMatch(page, /shopperRequests\.length > 0 \? shopperRequests : \[activeRequest\]/);
    assert.match(page, /bids\.filter\(\(b\) => b\.dealRequestId === activeRequest\.id\)/);
    assert.doesNotMatch(page, /BMW of San Rafael/);
    assert.doesNotMatch(page, /Peter Pan BMW/);
  });

  it("LiveDealRoom shows imported title, VIN, dealer, payment, and offer path — never leftover make/model", () => {
    const src = fs.readFileSync(path.join(process.cwd(), "components/LiveDealRoom.tsx"), "utf8");
    assert.match(src, /reviewTargetFromVehicle\(request\.targetVehicle\)/);
    assert.match(src, /reviewTarget\?\.vin/);
    assert.match(src, /reviewTarget\?\.dealerName/);
    assert.match(src, /reviewTarget\?\.locationLine/);
    assert.match(src, /offerPathLabel\(request\.directOffer\)/);
    assert.match(src, /formatDealStructures/);
    assert.match(src, /request\.targetOtdPrice/);
    assert.match(src, /DealVehiclesSummary/);
    assert.match(src, /b\.dealRequestId === request\.id/);
    assert.doesNotMatch(src, /flexibleCriteria\?\.make\} \$\{request\.flexibleCriteria\?\.model/);
    assert.doesNotMatch(src, /Find your car based on Make and Model/);
    assert.doesNotMatch(src, /BMW 3 Series/);
  });

  it("tracker row uses the imported vehicle plus VIN and dealer, not leftover BMW criteria", () => {
    const src = fs.readFileSync(path.join(process.cwd(), "components/DealTrackerDashboard.tsx"), "utf8");
    assert.match(src, /reviewTargetFromVehicle\(req\.targetVehicle\)/);
    assert.match(src, /reviewTarget\?\.vin/);
    assert.match(src, /offerPathLabel\(req\.directOffer\)/);
    assert.match(src, /DealVehiclesSummary/);
    assert.match(src, /DealerEngagementChips/);
    assert.match(src, /OfferCloseClockCard/);
    assert.match(src, /Extend \+24 hours|onUpdated/);
    assert.doesNotMatch(src, /MarketCheck/);
    assert.doesNotMatch(src, /Auto\.dev/);
    assert.doesNotMatch(src, /flexibleCriteria\.make\} \$\{req\.flexibleCriteria\.model/);
    assert.doesNotMatch(src, /\$24\.5k - \$26\.8k/);
    assert.doesNotMatch(src, /BMW 3 Series/);
  });

  it("Live Deal Room shows the close clock and per-dealer engagement chips", () => {
    const src = fs.readFileSync(path.join(process.cwd(), "components/LiveDealRoom.tsx"), "utf8");
    assert.match(src, /OfferCloseClockCard/);
    assert.match(src, /DealerEngagementChips/);
    assert.doesNotMatch(src, /MarketCheck/);
    assert.doesNotMatch(src, /Auto\.dev/);
    assert.match(src, /\/api\/deal-requests\/\$\{request\.id\}\/engagement/);
  });

  it("dealer inbox records viewed only when the offer is opened, and bid POST records responded", () => {
    const inbox = fs.readFileSync(path.join(process.cwd(), "app/api/dealer-requests/route.ts"), "utf8");
    const viewRoute = fs.readFileSync(path.join(process.cwd(), "app/api/deal-requests/[id]/view/route.ts"), "utf8");
    const bidsRoute = fs.readFileSync(path.join(process.cwd(), "app/api/deal-requests/[id]/bids/route.ts"), "utf8");
    const clickRoute = fs.readFileSync(path.join(process.cwd(), "app/d/[token]/route.ts"), "utf8");
    const portal = fs.readFileSync(path.join(process.cwd(), "components/DealerPortal.tsx"), "utf8");
    assert.match(inbox, /isDealAcceptingResponses/);
    assert.doesNotMatch(inbox, /recordDealerView/);
    assert.match(viewRoute, /recordDealerView/);
    assert.match(portal, /\/api\/deal-requests\/\$\{req\.requestId\}\/view/);
    assert.match(bidsRoute, /recordDealerRespond/);
    assert.match(bidsRoute, /isDealAcceptingResponses/);
    assert.match(clickRoute, /recordDealerClick/);
    assert.match(clickRoute, /recordDealerView/);
  });
});
