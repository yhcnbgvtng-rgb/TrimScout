// A request with several cars invites each dealer about its OWN car. The cash/finance compare must say so (not "same car in every
// column"), name each column's car, and not call a dealer's quote for the car it was asked about an "alternate".
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { UsedCompare } from "../components/UsedCompare";
import { askedVinForInvite, distinctInviteVehicles, isAlternateQuote } from "./alternateAsk";
import { activeRfqSummary } from "./rfqLogic";
import type { RfqInvite, RfqRequest } from "./rfq";

const car = (vin: string, make: string, model: string, trim: string) => ({ vin, year: 2020, make, model, trim, vdpUrl: null });
const invite = (id: string, dealerName: string, vehicle: ReturnType<typeof car>): RfqInvite =>
  ({ id, dealerName, dealerContactEmail: null, status: "invited", declineReason: null, invitedAt: "2026-10-08T00:00:00Z", respondedAt: null, quote: null, desk: null, vehicle }) as unknown as RfqInvite;
const A = car("5TFDY5F16JX766539", "Toyota", "Tundra", "SR5");
const B = car("JTNK4RBE8K3051690", "Toyota", "Corolla", "SE/XSE");
const C = car("2T3F1RFV4LC084047", "Toyota", "RAV4", "LE");
const base = { id: "32", buyerUserId: "3", status: "collecting", pickedQuoteId: null, createdAt: "2026-10-08T00:00:00Z", stockNumber: null, mustHaves: [], quotePrefs: { quoteType: "cash", cash: { zip: "07002", timeline: null } } };
const multi = { ...base, vin: A.vin, vehicleYear: 2020, vehicleMake: "Toyota", vehicleModel: "Tundra", vehicleTrim: "SR5", invites: [invite("1", "Dealer One", A), invite("2", "Dealer Two", B), invite("3", "Dealer Three", C)] } as unknown as RfqRequest;
const single = { ...base, vin: A.vin, vehicleYear: 2020, vehicleMake: "Toyota", vehicleModel: "Tundra", vehicleTrim: "SR5", invites: [invite("1", "Dealer One", A), invite("2", "Dealer Two", A)] } as unknown as RfqRequest;
const html = (r: RfqRequest) => renderToStaticMarkup(<UsedCompare rfq={r} prefs={r.quotePrefs!} onPick={() => {}} onWalk={() => {}} busy={false} />);

describe("multi-car compare header", () => {
  it("three cars: says each dealer quotes its own car and names the car under each dealer", () => {
    const h = html(multi);
    assert.match(h, /3 cars in this request — each dealer quotes its own car/);
    assert.doesNotMatch(h, /same car in every column/);
    assert.equal((h.match(/data-testid="column-vehicle"/g) || []).length, 3);
    for (const label of ["2020 Toyota Tundra SR5", "2020 Toyota Corolla SE/XSE", "2020 Toyota RAV4 LE"]) assert.ok(h.includes(label), label);
  });
  it("one car at two stores still reads 'same car in every column'", () => {
    const h = html(single);
    assert.match(h, /same car in every column: VIN/);
    assert.doesNotMatch(h, /multi-car-note|column-vehicle/);
  });
});

describe("which car was asked", () => {
  it("an invite asked about its own car; a quote for that car is not an alternate even when it is not the request's first car", () => {
    const inv = multi.invites[1];
    assert.equal(askedVinForInvite(multi, inv), B.vin);
    assert.equal(isAlternateQuote({ lane: "same_spec", vin: askedVinForInvite(multi, inv) }, B.vin), false);
    assert.equal(isAlternateQuote({ lane: "same_spec", vin: askedVinForInvite(multi, inv) }, C.vin), true, "a different car than this desk was asked about still is");
  });
  it("distinct cars in invite order; a request with no per-invite car falls back to the request VIN", () => {
    assert.deepEqual(distinctInviteVehicles(multi).map((v) => v.vin), [A.vin, B.vin, C.vin]);
    assert.deepEqual(distinctInviteVehicles(single).map((v) => v.vin), [A.vin]);
    assert.deepEqual(distinctInviteVehicles({ vin: "1abc", invites: [] }), [{ vin: "1ABC", label: "1ABC" }]);
  });
});

describe("the active request notice's data", () => {
  it("finds the one collecting request, with its deal number", () => {
    assert.deepEqual(activeRfqSummary([{ id: "30", status: "closed" }, { id: 32, status: "collecting", dealReference: "TS-ABC123" }]), { id: "32", dealReference: "TS-ABC123" });
    assert.deepEqual(activeRfqSummary([{ id: "33", status: "collecting" }]), { id: "33", dealReference: null });
  });
  it("is null with none, or with a bad payload", () => {
    assert.equal(activeRfqSummary([{ id: "30", status: "closed" }]), null);
    assert.equal(activeRfqSummary({}), null);
    assert.equal(activeRfqSummary(undefined), null);
  });
});
