import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { deskForSeedDealer, seedDealersOf } from "./seedDealers";
import { sanitizeQuoteSeed } from "./quoteSeed";
import type { DeskMatch } from "./deskResolve";

const D = (o: Partial<DeskMatch>): DeskMatch => ({ deskId: "1", dealerName: "Howell, INC.", city: "Summit", state: "MS", zip: null, knownNamed: true, emailOptOut: false, ...o });

describe("seed dealers", () => {
  it("lists each store once, in pick order", () => {
    const s = seedDealersOf([{ dealerName: "Howell" , dealerState: "ms" }, { dealerName: " howell ", dealerState: "MS" }, { dealerName: "" }, { dealerName: "Other", dealerState: null }]);
    assert.deepEqual(s.map((x) => x.dealerName), ["Howell", "Other"]);
  });
  it("matches the exact store with a named contact", () => {
    assert.equal(deskForSeedDealer([D({})], { dealerName: "Howell, Inc", dealerState: "MS" })?.deskId, "1");
  });
  it("does not take a fuzzy, other-state, ambiguous, no-contact or opted-out row", () => {
    assert.equal(deskForSeedDealer([D({ dealerName: "Howell Ford" })], { dealerName: "Howell" }), null);
    assert.equal(deskForSeedDealer([D({ state: "TX" })], { dealerName: "Howell, INC.", dealerState: "MS" }), null);
    assert.equal(deskForSeedDealer([D({}), D({ deskId: "2", city: "Other" })], { dealerName: "Howell, INC.", dealerState: "MS" }), null);
    assert.equal(deskForSeedDealer([D({ knownNamed: false })], { dealerName: "Howell, INC." }), null);
    assert.equal(deskForSeedDealer([D({ emailOptOut: true })], { dealerName: "Howell, INC." }), null);
  });
  it("seed keeps the store and still accepts a car without one", () => {
    const s = sanitizeQuoteSeed([{ vin: "1FTFW1E5XPFA10001", vdpUrl: null, dealerName: " Howell ", dealerState: "ms" }, { vin: "1FTFW1E5XPFA10002", vdpUrl: null }]);
    assert.equal(s[0].dealerName, "Howell"); assert.equal(s[0].dealerState, "MS"); assert.equal(s[1].dealerName, undefined);
  });
});
