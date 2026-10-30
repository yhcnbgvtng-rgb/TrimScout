// Alternate factory-sticker check (lib/altSticker.ts): one /api/gm-sticker ask per Chevrolet/GMC alternate VIN, cached,
// GM's answers respected (unreleased/unavailable are final, a refusal stops everything), and the labels the compare shows.
import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { fetchAltSticker, importAndPrime, needsAltSticker, resetAltStickerCache, unverifiedLabel, withStickerFacts } from "./altSticker";
import type { Vehicle } from "./types";

const VIN_A = "3GCUKFE80TG438076";
const VIN_B = "3GCUKFE81TG358091";

const car = (vin: string, over: Partial<Vehicle> = {}): Vehicle => ({
  id: vin, vin, year: 2026, make: "Chevrolet", model: "Silverado 1500", trim: "Trail Boss - LT", bodyType: "Truck", engine: "", drivetrain: "4WD", transmission: "",
  exteriorColor: "", interiorColor: "", msrp: 0, dealerPrice: 0, daysOnLot: 0, status: "in_stock",
  location: { dealerName: "Beck Chevrolet GMC", city: "", state: "TX", distanceMiles: 0, dealerConfirmed: true, dealerSource: "website" },
  packages: [], options: [], features: [], images: [], buildConfidence: "dealer_listing_only", ...over,
} as Vehicle);

const base = { handled: true, mustHaveLines: [], niceToHaveLines: [], filterableOptions: [], pdfUrl: null };
const released = (vin: string) => ({ ...base, vin, sticker: { status: "released", pdfUrl: null, msrp: 61000 }, buildConfidence: "verified_factory", vehicle: car(vin, { trim: "Trail Boss - LT", packages: ["Z71 Off-Road Package"], options: [{ name: "Z71 Off-Road Package" }] as never, buildConfidence: "verified_factory" }) });
const unreleased = (vin: string) => ({ ...base, vin, sticker: { status: "unreleased", pdfUrl: null, msrp: null }, buildConfidence: "dealer_listing_only", vehicle: car(vin) });
const unavailable = (vin: string, extra: Record<string, unknown> = {}) => ({ ...unreleased(vin), sticker: { status: "unavailable", pdfUrl: null, msrp: null }, stickerUnavailable: { reason: "GM blocked" }, ...extra });

function stub(answer: (vin: string) => unknown) {
  const calls: Array<{ url: string; vin: string }> = [];
  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body || "{}")) as { vin?: string; paste?: string };
    const vin = String(body.vin || body.paste || "").toUpperCase();
    calls.push({ url: String(input), vin });
    const out = answer(vin);
    if (out instanceof Error) throw out;
    return new Response(JSON.stringify(out), { status: 200, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  return { impl, calls };
}

describe("alternate sticker check", () => {
  beforeEach(() => resetAltStickerCache());

  it("only new Chevrolet and GMC alternates that have no factory read are checked", () => {
    assert.equal(needsAltSticker(car(VIN_A)), true);
    assert.equal(needsAltSticker(car(VIN_A, { make: "GMC" })), true);
    assert.equal(needsAltSticker(car(VIN_A, { make: "Ford" })), false);
    assert.equal(needsAltSticker(car(VIN_A, { make: "Buick" })), false);
    assert.equal(needsAltSticker(car(VIN_A, { condition: "used" })), false);
    assert.equal(needsAltSticker(car(VIN_A, { buildConfidence: "verified_factory" })), false);
    assert.equal(needsAltSticker(null), false);
  });

  it("asks /api/gm-sticker once per VIN and serves repeats from the cache", async () => {
    const { impl, calls } = stub((vin) => released(vin));
    const [first, again] = await Promise.all([fetchAltSticker(VIN_A, impl), fetchAltSticker(VIN_A.toLowerCase(), impl)]);
    await fetchAltSticker(VIN_A, impl);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "/api/gm-sticker");
    assert.equal(first.state.status, "verified");
    assert.equal(again, first);
    assert.deepEqual(first.vehicle?.packages, ["Z71 Off-Road Package"]);
    await fetchAltSticker(VIN_B, impl);
    assert.equal(calls.length, 2, "a different VIN is its own ask");
  });

  it("an unreleased sticker is a final answer — no retry", async () => {
    const { impl, calls } = stub((vin) => unreleased(vin));
    assert.equal((await fetchAltSticker(VIN_A, impl)).state.status, "unreleased");
    assert.equal((await fetchAltSticker(VIN_A, impl)).state.status, "unreleased");
    assert.equal(calls.length, 1);
  });

  it("an alternate whose sticker is unreleased is asked about once: the seat import primes the check", async () => {
    const { impl, calls } = stub((vin) => unreleased(vin));
    const seated = await importAndPrime(VIN_A, impl, { existingVehicles: [] });
    assert.equal(seated.ok, true);
    const check = await fetchAltSticker(VIN_A, impl);
    await fetchAltSticker(VIN_A, impl);
    assert.equal(check.state.status, "unreleased");
    assert.equal(calls.length, 1, "the check reused the seat import's answer");
  });

  it("a seat import that GM refused stops the next alternate's check too", async () => {
    const { impl, calls } = stub((vin) => unavailable(vin, { stickerBlocked: true }));
    await importAndPrime(VIN_A, impl, {});
    assert.equal((await fetchAltSticker(VIN_A, impl)).state.status, "unverified");
    assert.equal((await fetchAltSticker(VIN_B, impl)).state.status, "unverified");
    assert.equal(calls.length, 1);
  });

  it("a free decode (alternate lane) or another make is not mistaken for a sticker answer", async () => {
    const free = stub((vin) => unreleased(vin));
    await importAndPrime(VIN_A, free.impl, { freeDecodeOnly: true });
    await fetchAltSticker(VIN_A, free.impl);
    assert.equal(free.calls.filter((c) => c.url === "/api/gm-sticker").length, 1, "the check still asked GM itself");
  });

  it("an unavailable sticker or a failed request reads as not verified, also without retry", async () => {
    const { impl, calls } = stub((vin) => (vin === VIN_A ? unavailable(vin) : new Error("offline")));
    assert.equal((await fetchAltSticker(VIN_A, impl)).state.status, "unverified");
    assert.equal((await fetchAltSticker(VIN_B, impl)).state.status, "unverified");
    await fetchAltSticker(VIN_B, impl);
    assert.equal(calls.length, 2);
  });

  it("a refusal from GM stops every later sticker ask", async () => {
    const { impl, calls } = stub((vin) => unavailable(vin, { stickerBlocked: true }));
    assert.equal((await fetchAltSticker(VIN_A, impl)).state.status, "unverified");
    assert.equal((await fetchAltSticker(VIN_B, impl)).state.status, "unverified");
    assert.equal(calls.length, 1, "the second alternate never reached GM");
  });

  it("a read sticker brings its options and its own trim; the dealer and listing facts stay", async () => {
    const { impl } = stub((vin) => released(vin));
    const { vehicle } = await fetchAltSticker(VIN_A, impl);
    const merged = withStickerFacts(car(VIN_A, { trim: "LT Trail Boss", trimSource: "inventory" }), vehicle!);
    assert.equal(merged.trim, "Trail Boss - LT", "the sticker's trim");
    assert.equal(merged.trimSource, "sticker");
    assert.equal(merged.buildConfidence, "verified_factory");
    assert.deepEqual(merged.packages, ["Z71 Off-Road Package"]);
    assert.equal(merged.location.dealerName, "Beck Chevrolet GMC");
    const noTrim = withStickerFacts(car(VIN_A, { trim: "LT Trail Boss", trimSource: "inventory" }), { ...vehicle!, trim: "" });
    assert.equal(noTrim.trim, "LT Trail Boss", "a sticker with no trim leaves ours alone");
    assert.equal(noTrim.trimSource, "inventory");
  });

  it("says what is happening, in the buyer's words", () => {
    assert.equal(unverifiedLabel({ status: "checking" }), "Checking factory sticker…");
    assert.equal(unverifiedLabel({ status: "unreleased" }), "Sticker not published by GM yet");
    assert.equal(unverifiedLabel({ status: "unverified" }), "Not verified");
    assert.equal(unverifiedLabel(undefined), "Not verified");
  });
});
