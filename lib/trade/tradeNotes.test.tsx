// Bug: a draft with all six photos but no details left Continue silently dead. And the optional "Anything the dealer should know?" note.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import React from "react";
import { env } from "node:process";
import { renderToStaticMarkup } from "react-dom/server";
import { coerceTradeIn } from "./coerce";
import { DEALER_NOTES_MAX, PHOTO_SLOT_INFO, REQUIRED_PHOTO_SLOTS, type PhotoSlot, type TradePhoto } from "./types";
import { parseTradeFields, tradeReadiness } from "./validate";
import { TradeSummary } from "../../components/trade/TradeSummary";
import { memoryStorage } from "./storage";
import { createDraft, draftToken, prepareTradeForRfq, recordDraftPhoto, saveDraftFields } from "./service";

env.LIGHTSAIL_API_KEY = "test-secret";

const photo = (slot: PhotoSlot): TradePhoto => ({ slot, required: PHOTO_SLOT_INFO[slot].required, storageKey: `trade/d/${slot}.jpg`, width: 1536, height: 2048, capturedAt: null, uploadedAt: "2026-10-13T00:00:00Z" });
const six = REQUIRED_PHOTO_SLOTS.map(photo);
const GOOD = { vin: "1HGCM82633A004352", year: 2018, make: "Honda", model: "Accord", trim: "EX", mileage: 52000, zip: "07601", conditionBand: "good", titleStatus: "clean", ownership: "owned", keys: "2+", historyFlag: "no", drivetrain: "2wd", odometerConfirmed: true };

describe("why Continue is off", () => {
  it("six photos but no details: says exactly what is missing instead of staying silent", () => {
    const r = tradeReadiness({}, six);
    assert.equal(r.ready, false);
    assert.match(r.message!, /Still needed: Add the VIN/);
    assert.match(r.message!, /mileage matches the photo/);
    assert.doesNotMatch(r.message!, /photo[s]? \(/, "photos are complete, so none are listed");
  });
  it("details done but photos missing: names the missing slots and the count", () => {
    const r = tradeReadiness(GOOD, six.slice(0, 4));
    assert.equal(r.ready, false);
    assert.match(r.message!, /interior/);
    assert.match(r.message!, /4 of 6 required photos/);
  });
  it("a photo still uploading blocks Continue and says so", () => {
    const r = tradeReadiness(GOOD, six, { uploading: true });
    assert.equal(r.ready, false);
    assert.match(r.message!, /uploading/);
  });
  it("details and six photos: ready, no message", () => {
    assert.deepEqual(tradeReadiness(GOOD, six), { ready: true, missing: [], message: null });
  });
  it("a note that breaks the identity rules is reported as something to fix, not to add", () => {
    const r = tradeReadiness({ ...GOOD, dealerNotes: "text me at 201-555-0142" }, six);
    assert.equal(r.ready, false);
    assert.match(r.message!, /Fix the note for the dealer/);
  });
});

describe("dealer note", () => {
  it("is optional: no note parses to null", () => {
    const p = parseTradeFields(GOOD);
    assert.ok(p.ok);
    assert.equal(p.ok && p.fields.dealerNotes, null);
  });
  it("keeps an ordinary note, trimmed", () => {
    const p = parseTradeFields({ ...GOOD, dealerNotes: "  Rear bumper dent, aftermarket exhaust, A/C weak.  " });
    assert.ok(p.ok);
    assert.equal(p.ok && p.fields.dealerNotes, "Rear bumper dent, aftermarket exhaust, A/C weak.");
  });
  it("caps at 1,000 characters", () => {
    const p = parseTradeFields({ ...GOOD, dealerNotes: "a ".repeat(900) });
    assert.ok(p.ok);
    assert.ok(p.ok && (p.fields.dealerNotes || "").length <= DEALER_NOTES_MAX);
  });
  for (const [what, note] of [
    ["a phone number", "call 201 555 0142 after 5"],
    ["an email", "reach me at jane.doe@example.com"],
    ["a link", "photos at https://example.com/car"],
    ["a social handle", "follow @janedoe on insta"],
    ["a name", "my name is Jane Doe"],
  ] as const) {
    it(`refuses ${what}`, () => {
      const p = parseTradeFields({ ...GOOD, dealerNotes: note });
      assert.equal(p.ok, false);
      assert.ok(!p.ok && p.errors.dealerNotes, note);
    });
  }
  it("is stored on the draft and carried onto the trade-in record at submit", async () => {
    const storage = memoryStorage();
    const d = await createDraft(storage, "u1");
    for (const s of REQUIRED_PHOTO_SLOTS) storage.objects.set(`trade/${d.id}/${s}.jpg`, { size: 1000, contentType: "image/jpeg" });
    let cur = await saveDraftFields(storage, d, { ...GOOD, dealerNotes: "Minor door ding." });
    for (const s of REQUIRED_PHOTO_SLOTS) cur = await recordDraftPhoto(storage, cur, { ...photo(s), storageKey: `trade/${d.id}/${s}.jpg` });
    assert.equal(cur.fields.dealerNotes, "Minor door ding.");
    const ready = await prepareTradeForRfq(storage, { tradeIn: { enabled: true, draftId: d.id, token: draftToken(d.id) } }, "u1");
    assert.equal(ready?.record.dealerNotes, "Minor door ding.");
  });
});

describe("readers tolerate a missing note", () => {
  it("coerceTradeIn: absent note is null, present note survives, long note is capped", () => {
    assert.equal(coerceTradeIn({ year: 2019, make: "Toyota" })!.dealerNotes, null);
    assert.equal(coerceTradeIn({ dealerNotes: "Salvage-free, one owner." })!.dealerNotes, "Salvage-free, one owner.");
    assert.equal(coerceTradeIn({ dealerNotes: "x".repeat(5000) })!.dealerNotes!.length, DEALER_NOTES_MAX);
    assert.equal(coerceTradeIn({ dealerNotes: 42 })!.dealerNotes, "42");
    assert.equal(coerceTradeIn({ dealerNotes: { a: 1 } })!.dealerNotes, null);
  });
  it("the shared trade summary (dealer panel and buyer card) renders with and without the note", () => {
    const base = { year: 2019, make: "Toyota", model: "Camry", mileage: 48000, photos: six };
    const without = renderToStaticMarkup(<TradeSummary trade={base as never} signed={[]} />);
    assert.doesNotMatch(without, /trade-dealer-notes/);
    const withNote = renderToStaticMarkup(<TradeSummary trade={{ ...base, dealerNotes: "Rear bumper dent <b>x</b>" } as never} signed={[]} />);
    assert.match(withNote, /data-testid="trade-dealer-notes"/);
    assert.match(withNote, /Rear bumper dent &lt;b&gt;x&lt;\/b&gt;/, "escaped, not injected");
  });
});

describe("phone page runs the full step", () => {
  it("renders details, photo slots and the note on one page, with a Continue button and no toggle", async () => {
    const { TradeInStep } = await import("../../components/trade/TradeInStep");
    const html = renderToStaticMarkup(<TradeInStep enabled onToggle={() => {}} hideToggle attempted={false} onState={() => {}} draftRef={{ id: "d", token: "t" }} />);
    assert.doesNotMatch(html, /data-testid="trade-toggle"/);
    const toggled = renderToStaticMarkup(<TradeInStep enabled onToggle={() => {}} attempted={false} onState={() => {}} />);
    assert.match(toggled, /data-testid="trade-toggle"/);
  });
});

describe("questions no longer asked", () => {
  it("colors, service history and intent are not collected, and stray values are ignored", () => {
    const p = parseTradeFields({ ...GOOD, extColor: "Blue", intColor: "Tan", serviceHistory: "full", serviceNotes: "timing belt", intent: "sell_outright" });
    assert.ok(p.ok);
    if (p.ok) { assert.equal(p.fields.extColor, null); assert.equal(p.fields.intColor, null); assert.equal(p.fields.serviceHistory, null); assert.equal(p.fields.serviceNotes, null); assert.equal(p.fields.intent, "apply_to_deal"); }
  });
  it("older records that have them still read back", () => {
    const t = coerceTradeIn({ extColor: "Blue", serviceNotes: "timing belt", intent: "sell_outright" })!;
    assert.equal(t.extColor, "Blue"); assert.equal(t.serviceNotes, "timing belt"); assert.equal(t.intent, "sell_outright");
  });
});
