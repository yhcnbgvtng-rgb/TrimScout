import assert from "node:assert/strict";
import { describe, it } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { TradePhotoSlots } from "../../components/trade/TradePhotoSlots";
import { PHOTO_SLOT_INFO, REQUIRED_PHOTO_SLOTS, type PhotoSlot, type TradePhoto } from "./types";

const photo = (slot: PhotoSlot): TradePhoto => ({ slot, required: PHOTO_SLOT_INFO[slot].required, storageKey: `trade/d/${slot}.jpg`, width: 2048, height: 1536, capturedAt: null, uploadedAt: "2026-10-08T00:00:00Z" });
const props = { urls: {}, busySlot: null, slotError: null, onPick: () => {}, onRemove: () => {} };

describe("guided photo slots", () => {
  it("shows all six required slots with their labels and hints, then the recommended extras", () => {
    const html = renderToStaticMarkup(<TradePhotoSlots {...props} photos={[]} />);
    for (const s of REQUIRED_PHOTO_SLOTS) { assert.match(html, new RegExp(`data-testid="slot-${s}"`)); assert.match(html, new RegExp(PHOTO_SLOT_INFO[s].label)); }
    assert.match(html, /Car ON, mileage readable, warning lights visible/);
    assert.match(html, /Front and the rest|Recommended extras/);
    assert.equal((html.match(/Recommended<\/span>/g) || []).length, 6, "six optional slots");
    assert.match(html, /0 of 6 required photos/);
  });
  it("progress reads '4 of 6 required photos' and points at the first missing slot", () => {
    const html = renderToStaticMarkup(<TradePhotoSlots {...props} photos={[photo("front"), photo("rear"), photo("driver_side"), photo("odometer")]} />);
    assert.match(html, /4 of 6 required photos/); assert.match(html, /Next: Passenger side/);
  });
  it("phones go one required slot at a time and open the camera", () => {
    const html = renderToStaticMarkup(<TradePhotoSlots {...props} guided photos={[photo("front")]} />);
    assert.match(html, /capture="environment"/);
    assert.match(html, /data-testid="slot-rear"/); assert.doesNotMatch(html, /data-testid="slot-interior"/);
    assert.doesNotMatch(html, /Recommended extras/, "extras wait until the six are in");
    const done = renderToStaticMarkup(<TradePhotoSlots {...props} guided photos={REQUIRED_PHOTO_SLOTS.map(photo)} />);
    assert.match(done, /6 of 6 required photos/); assert.match(done, /Recommended extras/);
  });
  it("a dealer-requested slot is marked as requested", () => {
    const html = renderToStaticMarkup(<TradePhotoSlots {...props} photos={REQUIRED_PHOTO_SLOTS.map(photo)} requested={["tire_tread"]} />);
    assert.match(html, /Requested by a dealer/);
  });
});
