import "./testdata/blockLiveHttp";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { clearStickerRecheckMisses, isStickerRecheckCandidate, recheckPendingStickers } from "./stickerRecheck";
import type { RfqRequest } from "./rfq";

const rfq = (pastes: Array<Record<string, unknown>>) =>
  ({ vin: String(pastes[0].vin), vehicleYear: 2026, vehicleMake: "Hyundai", vehicleModel: "Tucson", vehicleTrim: "", linkPastes: pastes }) as unknown as RfqRequest;
const paste = (vin: string, over: Record<string, unknown> = {}) => ({ vin, year: 2026, make: "Hyundai", model: "Tucson", trim: "Limited", dealerName: "D", dealerState: "PA", vdpUrl: null, buildConfidence: "dealer_listing_only", resolvedAt: "2026-09-14T00:00:00Z", condition: "new", ...over });
const released = (vin: string) => ({ vin, status: "released" as const, make: "Hyundai", msrp: 44110, pdfUrl: `https://hyundai-sticker.dealerfire.com/new/${vin}`, exteriorColor: "Atlantis Blue", drivetrain: "AWD", source: "dealerfire" as const, basePrice: 0, optionsPrice: 0, destination: 0, options: [], standardEquipment: [], rawText: "", fetchedAt: "" });

describe("sticker re-check — 'we'll keep checking' means every time the request is opened", () => {
  it("only new, unverified Hyundai-group VINs are candidates", () => {
    assert.equal(isStickerRecheckCandidate({ vin: "5NMJECDE6TH781852", condition: "new", factoryVerified: false, msrp: null }), true);
    assert.equal(isStickerRecheckCandidate({ vin: "5NMJECDE6TH781852", condition: "new", factoryVerified: true, msrp: 44110 }), false, "already verified");
    assert.equal(isStickerRecheckCandidate({ vin: "5NMJECDE6TH781852", condition: "used", factoryVerified: false, msrp: null }), false, "used cars don't need a sticker");
    assert.equal(isStickerRecheckCandidate({ vin: "1GNS6MKD2TR280381", condition: "new", factoryVerified: false, msrp: null }), false, "not a brand this re-asks");
  });
  it("a hit comes back keyed by VIN with MSRP + PDF; a miss is remembered for an hour so the page doesn't hammer the host", async () => {
    clearStickerRecheckMisses();
    let calls = 0;
    const getSticker = (async (vin: string) => { calls++; return vin === "5NMJECDE6TH781852" ? released(vin) : { ...released(vin), status: "unreleased" as const }; }) as never;
    let t = 1_000_000;
    const r = rfq([paste("5NMJECDE6TH781852"), paste("KM8RKES23TU034116"), paste("1GNS6MKD2TR280381", { make: "Chevrolet" })]);
    const first = await recheckPendingStickers(r, { getSticker, now: () => t });
    assert.deepEqual(Object.keys(first), ["5NMJECDE6TH781852"]);
    assert.equal(first["5NMJECDE6TH781852"].msrp, 44110);
    assert.equal(calls, 2, "the Chevrolet is never asked");
    await recheckPendingStickers(r, { getSticker, now: () => t + 10_000 });
    assert.equal(calls, 3, "the hit is asked again (its module caches it); the miss is skipped inside the hour");
    t += 61 * 60 * 1000;
    await recheckPendingStickers(r, { getSticker, now: () => t });
    assert.equal(calls, 5, "after an hour the miss is retried");
  });
  it("wiring: the buyer deal GET and the dealer context both re-check; the pages show the sticker", () => {
    const read = (f: string) => fs.readFileSync(path.join(process.cwd(), f), "utf8");
    assert.match(read("app/api/rfqs/[id]/route.ts"), /recheckPendingStickers\(rfq\)/);
    assert.match(read("app/api/quote-invite/context/route.ts"), /factoryStickerUrl: recheck\?\.pdfUrl \|\| null/);
    assert.match(read("app/api/quote-invite/context/route.ts"), /msrp: thisCar\?\.msrp \?\? recheck\?\.msrp \?\? null/);
    assert.match(read("app/rfq/[id]/page.tsx"), /data-testid="sticker-published"/);
    assert.match(read("app/quote-request/received/page.tsx"), /data-testid="factory-sticker-link"/);
  });
});
