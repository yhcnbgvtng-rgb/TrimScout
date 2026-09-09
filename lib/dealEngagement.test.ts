import "./testdata/blockLiveHttp";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyClick,
  applyExtend,
  applyRespond,
  applySeedInvites,
  applyView,
  emptyEngagementStore,
  invitedDealersFromVehicles,
  looksLikeTruncatedDealerName,
  normalizeDealerKey,
  snapshotDealEngagement,
} from "./dealEngagement";
import { OFFER_CLOCK_EXTEND_MS, OFFER_CLOCK_RUNNING_MS } from "./offerCloseClock";
import type { Vehicle } from "./types";

const now = new Date("2026-06-10T14:00:00.000Z");

const njDealer: Vehicle = {
  id: "v1",
  vin: "1FMWK8JCXTGB47204",
  year: 2026,
  make: "Ford",
  model: "Explorer",
  trim: "ST",
  bodyType: "",
  engine: "",
  drivetrain: "",
  transmission: "",
  exteriorColor: "",
  interiorColor: "",
  msrp: 0,
  dealerPrice: 0,
  daysOnLot: 0,
  status: "on_lot",
  location: { dealerName: "All American Ford of Old Bridge", city: "Old Bridge", state: "NJ", distanceMiles: 12 },
  packages: [],
  options: [],
  imageUrl: "",
  mileage: 0,
};

describe("invited dealers come from imported rooftops only", () => {
  it("does not invent a dealer when the vehicle has none", () => {
    const empty = invitedDealersFromVehicles({
      ...njDealer,
      location: { dealerName: "", city: "", state: "", distanceMiles: 0 },
    });
    assert.equal(empty.length, 0);
  });

  it("seeds the favorite rooftop and other lots, deduped", () => {
    const other: Vehicle = {
      ...njDealer,
      vin: "1FMWK8JC7TGB81309",
      location: { dealerName: "Lilliston Ford", city: "Vineland", state: "NJ", distanceMiles: 40 },
    };
    const seeds = invitedDealersFromVehicles(njDealer, [other, njDealer]);
    assert.equal(seeds.length, 2);
    assert.equal(seeds[0].dealerName, "All American Ford of Old Bridge");
    assert.equal(seeds[1].dealerName, "Lilliston Ford");
  });
});

describe("engagement events are honest", () => {
  it("click does not mark viewed or responded, and does not start the clock", () => {
    const store = emptyEngagementStore();
    const deal = applySeedInvites(
      store,
      "42",
      [{ dealerName: "All American Ford of Old Bridge", dealerState: "NJ", knownRooftop: true }],
      "America/New_York",
      () => "tok-aa"
    );
    applyClick(store, "tok-aa", now);
    const snap = snapshotDealEngagement(deal, now);
    assert.equal(snap.dealers[0].clicked, true);
    assert.equal(snap.dealers[0].viewed, false);
    assert.equal(snap.dealers[0].responded, false);
    assert.equal(snap.clock.status, "idle");
    assert.equal(snap.clock.remainingMs, OFFER_CLOCK_RUNNING_MS);
  });

  it("view starts the 48h clock and leaves clicked false when they skipped the email link", () => {
    const store = emptyEngagementStore();
    applySeedInvites(
      store,
      "42",
      [{ dealerName: "All American Ford of Old Bridge", dealerState: "NJ", knownRooftop: true }],
      "America/New_York",
      () => "tok-aa"
    );
    applyView(store, { dealRequestId: "42", dealerName: "All American Ford of Old Bridge" }, now);
    const snap = snapshotDealEngagement(store.deals["42"], now);
    assert.equal(snap.dealers[0].clicked, false);
    assert.equal(snap.dealers[0].viewed, true);
    assert.equal(snap.dealers[0].responded, false);
    assert.equal(snap.clock.status, "running");
    assert.ok(snap.clock.startedAt);
  });

  it("respond records viewed but still does not fake an email click", () => {
    const store = emptyEngagementStore();
    applySeedInvites(
      store,
      "42",
      [{ dealerName: "All American Ford of Old Bridge", dealerState: "NJ", knownRooftop: true }],
      "America/New_York",
      () => "tok-aa"
    );
    applyRespond(store, { dealRequestId: "42", dealerName: "All American Ford of Old Bridge" }, now);
    const snap = snapshotDealEngagement(store.deals["42"], now);
    assert.equal(snap.dealers[0].clicked, false);
    assert.equal(snap.dealers[0].viewed, true);
    assert.equal(snap.dealers[0].responded, true);
  });

  it("extend adds 24 running hours while the offer is open", () => {
    const store = emptyEngagementStore();
    applySeedInvites(
      store,
      "42",
      [{ dealerName: "All American Ford of Old Bridge", dealerState: "NJ", knownRooftop: true }],
      "America/New_York",
      () => "tok-aa"
    );
    applyView(store, { dealRequestId: "42", dealerName: "All American Ford of Old Bridge" }, now);
    applyExtend(store, "42", now);
    const snap = snapshotDealEngagement(store.deals["42"], now);
    assert.equal(snap.clock.allottedRunningMs, OFFER_CLOCK_RUNNING_MS + OFFER_CLOCK_EXTEND_MS);
  });
});

describe("normalizeDealerKey — exact-after-normalization, never fuzzy", () => {
  it("is case- and whitespace-insensitive", () => {
    assert.equal(normalizeDealerKey("Nielsen Ford"), normalizeDealerKey("  nielsen   FORD  "));
  });

  it("treats common corporate-suffix formatting as identical", () => {
    const base = normalizeDealerKey("Nielsen Ford of Morristown");
    assert.equal(normalizeDealerKey("Nielsen Ford of Morristown, Inc."), base);
    assert.equal(normalizeDealerKey("Nielsen Ford of Morristown Inc"), base);
    assert.equal(normalizeDealerKey("Nielsen Ford of Morristown, LLC"), base);
    assert.equal(normalizeDealerKey("Nielsen Ford of Morristown Corp."), base);
    assert.equal(normalizeDealerKey("Nielsen Ford of Morristown Co."), base);
    assert.equal(normalizeDealerKey("Nielsen Ford of Morristown Ltd"), base);
  });

  it("treats an ampersand the same as 'and'", () => {
    assert.equal(normalizeDealerKey("Smith & Sons Ford"), normalizeDealerKey("Smith and Sons Ford"));
  });

  it("never merges two different sibling rooftops in the same dealer group — location qualifiers are preserved on purpose", () => {
    assert.notEqual(
      normalizeDealerKey("Nielsen Ford of Morristown, Inc."),
      normalizeDealerKey("Nielsen Ford of Springfield, Inc.")
    );
  });

  it("treats the confirmed Ford sticker truncation ('In' from 'Inc.') as the same suffix — the canonical name a dealer account is registered under always comes from dealership_contacts, never the window sticker, so reconciling the truncated side is safe", () => {
    assert.equal(
      normalizeDealerKey("Nielsen Ford of Morristown, In"),
      normalizeDealerKey("Nielsen Ford of Morristown, Inc.")
    );
  });
});

describe("looksLikeTruncatedDealerName — a heads-up signal for truncation shapes we haven't confirmed/handled yet", () => {
  it("no longer flags the 'Inc.' -> 'In' truncation — normalizeDealerKey now reconciles it directly", () => {
    assert.equal(looksLikeTruncatedDealerName("Nielsen Ford of Morristown, In"), false);
  });

  it("does not flag an ordinary, untruncated name of the same rough length", () => {
    // Same length range, but a real complete word at the end.
    assert.equal(looksLikeTruncatedDealerName("Sunrise Toyota of Springfield"), false);
  });

  it("does not flag a name ending in an already-recognized corporate suffix", () => {
    assert.equal(looksLikeTruncatedDealerName("Nielsen Ford of Morristown Co"), false);
  });

  it("does not flag short names — nothing to truncate at this length", () => {
    assert.equal(looksLikeTruncatedDealerName("Nielsen Ford"), false);
  });

  it("does not flag names well outside the suspect length range", () => {
    assert.equal(looksLikeTruncatedDealerName("Family Ford of North Bergen County"), false);
    assert.equal(looksLikeTruncatedDealerName("A B"), false);
  });
});
