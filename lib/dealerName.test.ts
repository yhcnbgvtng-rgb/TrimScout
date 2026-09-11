import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { firmOfferDealerKeys, isFirmOfferRecipient } from "./dealerName";

describe("firmOfferDealerKeys", () => {
  const structure = {
    dealerName: "Bachrodt BMW",
    otherLots: [
      { vin: "VIN2", location: { dealerName: "Paul Miller BMW, Inc." } },
      { vin: "VIN3", location: { dealerName: "" } },
      { vin: "VIN4" },
    ],
  };

  it("collects the primary and every named alternate, normalized", () => {
    const keys = firmOfferDealerKeys(structure);
    assert.deepEqual([...keys].sort(), ["bachrodt bmw", "paul miller bmw"]);
  });

  it("is empty for a missing or nameless structure", () => {
    assert.equal(firmOfferDealerKeys(null).size, 0);
    assert.equal(firmOfferDealerKeys({}).size, 0);
    assert.equal(firmOfferDealerKeys({ otherLots: "not an array" }).size, 0);
  });
});

describe("isFirmOfferRecipient", () => {
  const structure = {
    dealerName: "Bachrodt BMW",
    otherLots: [{ vin: "VIN2", location: { dealerName: "Paul Miller BMW, Inc." } }],
  };

  it("matches the primary dealer and any alternate's dealer", () => {
    assert.equal(isFirmOfferRecipient("Bachrodt BMW", structure), true);
    assert.equal(isFirmOfferRecipient("bachrodt bmw", structure), true);
    // Suffix and punctuation differences are the normal case between a
    // window sticker / listing page and the dealer's registered account name.
    assert.equal(isFirmOfferRecipient("Paul Miller BMW", structure), true);
    assert.equal(isFirmOfferRecipient("Paul Miller BMW Inc", structure), true);
  });

  it("does not match a dealership the buyer never named", () => {
    assert.equal(isFirmOfferRecipient("Open Road BMW", structure), false);
    assert.equal(isFirmOfferRecipient("", structure), false);
    assert.equal(isFirmOfferRecipient(null, structure), false);
    assert.equal(isFirmOfferRecipient("Bachrodt BMW", null), false);
  });
});
