import assert from "node:assert/strict";
import { describe, it, beforeEach } from "node:test";
import { env } from "node:process";
import { isValidVin, parseTradeFields, requiredPhotoProgress, photoProgressLabel, validatePhotoSet } from "./validate";
import { analyzePixels, fitWithin, judgeFile, judgePhoto, readExifCaptureTime } from "./photoQuality";
import { allowanceOf, applyToFinance, applyToLease, compareByOtdAfterThenEquity, computeEquity, otdBeforeAfter, tradeEquity } from "./otd";
import { memoryStorage } from "./storage";
import { REQUIRED_PHOTO_SLOTS, PHOTO_SLOT_INFO, type DealerTradeAppraisal, type PhotoSlot, type TradePhoto } from "./types";
import { adoptDraftIntoRfq, confirmPhoto, createDraft, draftToken, loadDraft, latestDraftFor, prepareTradeForRfq, presignPhotoUpload, recordDraftPhoto, saveDraftFields, TradeError, verifyDraftToken, withoutOptionalPhoto } from "./service";
import { dealerMayViewTrade, signTradePhotos } from "./access";
import { isOutlier } from "./guide";

env.LIGHTSAIL_API_KEY = "test-secret";
const VIN = "1HGCM82633A004352"; // valid check digit
const goodFields = () => ({
  vin: VIN, year: 2003, make: "Honda", model: "Accord", trim: "EX", decodedFromVin: true, mileage: 120000, zip: "07981",
  conditionBand: "good", titleStatus: "clean", ownership: "owned", keys: "2+", historyFlag: "no", drivetrain: "2wd", options: [], odometerConfirmed: true,
});
const photo = (slot: PhotoSlot, over: Partial<TradePhoto> = {}): TradePhoto => ({ slot, required: PHOTO_SLOT_INFO[slot].required, storageKey: `trade/d/${slot}.jpg`, width: 2048, height: 1536, capturedAt: null, uploadedAt: "2026-10-08T00:00:00Z", ...over });
const sixPhotos = () => REQUIRED_PHOTO_SLOTS.map((s) => photo(s));

describe("VIN + fields", () => {
  it("validates length, characters and the check digit", () => {
    assert.ok(isValidVin(VIN));
    assert.ok(!isValidVin("1HGCM82633A00435")); // 16
    assert.ok(!isValidVin("1HGCM82633A004353")); // bad check digit
    assert.ok(!isValidVin("1HGCM82633A00435I")); // I not allowed
  });
  it("accepts a complete, owned vehicle", () => assert.ok(parseTradeFields(goodFields()).ok));
  it("blocks submit on every missing required field", () => {
    const r = parseTradeFields({});
    assert.ok(!r.ok); if (!r.ok) for (const k of ["vin", "year", "make", "model", "trim", "mileage", "zip", "conditionBand", "titleStatus", "ownership", "keys", "historyFlag", "drivetrain", "odometerConfirmed"]) assert.ok(r.errors[k], k);
  });
  it("financed / leased need a lender and a payoff estimate; owned does not", () => {
    for (const ownership of ["financed", "leased"]) {
      const r = parseTradeFields({ ...goodFields(), ownership });
      assert.ok(!r.ok); if (!r.ok) { assert.ok(r.errors.lenderName); assert.ok(r.errors.payoffEstimate); }
    }
    const ok = parseTradeFields({ ...goodFields(), ownership: "financed", lenderName: "Chase", payoffEstimate: "$14,250" });
    assert.ok(ok.ok); if (ok.ok) { assert.equal(ok.fields.payoffEstimate, 14250); assert.equal(ok.fields.lenderName, "Chase"); }
    const owned = parseTradeFields({ ...goodFields(), lenderName: "Chase", payoffEstimate: 9000 });
    assert.ok(owned.ok); if (owned.ok) { assert.equal(owned.fields.payoffEstimate, 0); assert.equal(owned.fields.lenderName, null); }
  });
  it("history 'Yes' needs a note; 'other' option needs text; mileage and ZIP are bounded", () => {
    assert.ok(!parseTradeFields({ ...goodFields(), historyFlag: "yes" }).ok);
    assert.ok(parseTradeFields({ ...goodFields(), historyFlag: "yes", historyNotes: "Rear bumper repaired 2022" }).ok);
    assert.ok(!parseTradeFields({ ...goodFields(), options: ["other"] }).ok);
    assert.ok(!parseTradeFields({ ...goodFields(), mileage: 900000 }).ok);
    assert.ok(!parseTradeFields({ ...goodFields(), mileage: "abc" }).ok);
    assert.ok(!parseTradeFields({ ...goodFields(), zip: "0798" }).ok);
  });
  it("odometer confirmation is required; contact info is refused in free text", () => {
    assert.ok(!parseTradeFields({ ...goodFields(), odometerConfirmed: false }).ok);
    assert.ok(!parseTradeFields({ ...goodFields(), mods: "call me 201-555-0100" }).ok);
  });
});

describe("required photos", () => {
  it("progress counts only the six required slots and points at the first missing", () => {
    const four = [photo("front"), photo("rear"), photo("driver_side"), photo("odometer"), photo("tire_tread")];
    const p = requiredPhotoProgress(four);
    assert.equal(p.have, 4); assert.equal(p.firstMissing, "passenger_side"); assert.equal(photoProgressLabel(four), "4 of 6 required photos");
    assert.ok(!p.complete);
  });
  it("a photo set needs all six; extras are fine; duplicates are not", () => {
    assert.ok(validatePhotoSet(sixPhotos()).ok);
    assert.ok(validatePhotoSet([...sixPhotos(), photo("rear_cargo"), photo("damage_1")]).ok);
    assert.ok(!validatePhotoSet(sixPhotos().slice(0, 5)).ok);
    assert.ok(!validatePhotoSet([...sixPhotos(), photo("front")]).ok);
  });
});

describe("image quality rejects", () => {
  const img = (w: number, h: number, fn: (x: number, y: number) => number) => {
    const d = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const v = fn(x, y); const i = (y * w + x) * 4; d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255; }
    return d;
  };
  const sharp = img(160, 120, (x, y) => ((x >> 2) + (y >> 2)) % 2 === 0 ? 220 : 40);
  const black = img(160, 120, () => 4);
  const flat = img(160, 120, (x) => 100 + (x % 2));
  it("accepts a bright, sharp frame at full size", () => {
    assert.deepEqual(judgePhoto({ width: 3000, height: 2000 }, analyzePixels(sharp, 160, 120)), { ok: true });
  });
  it("rejects under 1024px on the short edge", () => {
    const v = judgePhoto({ width: 1600, height: 900 }, analyzePixels(sharp, 160, 120));
    assert.ok(!v.ok && v.reason === "too_small");
  });
  it("rejects near-black frames", () => {
    const v = judgePhoto({ width: 3000, height: 2000 }, analyzePixels(black, 160, 120));
    assert.ok(!v.ok && v.reason === "too_dark");
  });
  it("rejects heavily blurred (flat, no edges) frames", () => {
    const v = judgePhoto({ width: 3000, height: 2000 }, analyzePixels(flat, 160, 120));
    assert.ok(!v.ok && v.reason === "too_blurry");
  });
  it("file gate: jpeg/png/heic only, max 10 MB", () => {
    assert.ok(judgeFile({ type: "image/heic", size: 1000 }).ok);
    assert.ok(judgeFile({ type: "", size: 1000, name: "IMG_1.HEIC" }).ok);
    assert.ok(!judgeFile({ type: "image/gif", size: 1000 }).ok);
    assert.ok(!judgeFile({ type: "image/jpeg", size: 10 * 1024 * 1024 + 1 }).ok);
  });
  it("resizes to a 2048px long edge without upscaling", () => {
    assert.deepEqual(fitWithin(4000, 3000), { width: 2048, height: 1536 });
    assert.deepEqual(fitWithin(1600, 1200), { width: 1600, height: 1200 });
  });
  it("reads the EXIF capture time and nothing else (GPS never read)", () => {
    const body = new TextEncoder().encode("Exif\0\0II*\0 2026:10:08 14:05:09\0 GPS 40.7N");
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe1, (body.length + 2) >> 8, (body.length + 2) & 255, ...body]);
    assert.equal(readExifCaptureTime(jpeg), "2026-10-08T14:05:09");
    assert.equal(readExifCaptureTime(new Uint8Array([1, 2, 3, 4])), null);
  });
});

const appraisal = (over: Partial<DealerTradeAppraisal> = {}): DealerTradeAppraisal => ({ allowanceSingle: 18000, allowanceLow: null, allowanceHigh: null, basis: "preliminary", goodUntil: "2026-12-01T00:00:00Z", payoffUsed: 6000, equityComputed: 12000, conditions: null, createdAt: "2026-10-08T00:00:00Z", ...over });
const NOW = new Date("2026-10-08T12:00:00Z");

describe("equity math", () => {
  it("positive equity comes off OTD", () => {
    const eq = tradeEquity(true, 6000, appraisal(), NOW);
    assert.equal(eq.status, "quoted"); assert.equal(eq.net, 12000); assert.ok(!eq.negative);
    const o = otdBeforeAfter(43200, eq); assert.equal(o.before, 43200); assert.equal(o.after, 31200);
  });
  it("negative equity is added to OTD", () => {
    const eq = tradeEquity(true, 19000, appraisal({ allowanceSingle: 15000 }), NOW);
    assert.equal(eq.net, -4000); assert.ok(eq.negative);
    assert.equal(otdBeforeAfter(43200, eq).after, 47200);
  });
  it("a range quotes low/high/mid; OTD after carries the range", () => {
    const eq = tradeEquity(true, 6000, appraisal({ allowanceSingle: null, allowanceLow: 16000, allowanceHigh: 20000 }), NOW);
    assert.deepEqual([eq.netLow, eq.net, eq.netHigh], [10000, 12000, 14000]);
    const o = otdBeforeAfter(40000, eq); assert.deepEqual([o.afterLow, o.after, o.afterHigh], [26000, 28000, 30000]);
    assert.ok(allowanceOf(appraisal({ allowanceSingle: null, allowanceLow: 20000, allowanceHigh: 16000 })) === null);
  });
  it("pending / expired / no trade leave the dealer's OTD untouched", () => {
    assert.equal(tradeEquity(false, 0, null, NOW).status, "none");
    const pending = tradeEquity(true, 6000, null, NOW);
    assert.equal(pending.status, "pending"); assert.equal(otdBeforeAfter(43200, pending).after, 43200); assert.ok(!otdBeforeAfter(43200, pending).changed);
    const expired = tradeEquity(true, 6000, appraisal({ goodUntil: "2026-10-01T00:00:00Z" }), NOW);
    assert.equal(expired.status, "expired"); assert.equal(otdBeforeAfter(43200, expired).after, 43200);
  });
  it("dealer-side equity = midpoint allowance − payoff used", () => {
    assert.equal(computeEquity(allowanceOf(appraisal())!, 6000), 12000);
    assert.equal(computeEquity(allowanceOf(appraisal({ allowanceSingle: 5000 }))!, 9000), -4000);
  });
  it("finance: positive equity is cash down; negative is rolled into the amount financed", () => {
    const up = applyToFinance(tradeEquity(true, 6000, appraisal(), NOW), 30000);
    assert.equal(up.how, "cash_down"); assert.equal(up.amount, 12000); assert.equal((up as { adjusted: number }).adjusted, 18000);
    const down = applyToFinance(tradeEquity(true, 19000, appraisal({ allowanceSingle: 15000 }), NOW), 30000);
    assert.equal(down.how, "rolled_into_financed"); assert.equal(down.amount, 4000); assert.equal((down as { adjusted: number }).adjusted, 34000);
    assert.equal(applyToFinance(tradeEquity(true, 6000, null, NOW), 30000).how, "none");
  });
  it("lease: positive equity reduces cap cost; negative is rolled into it", () => {
    const up = applyToLease(tradeEquity(true, 6000, appraisal(), NOW), 50000);
    assert.equal(up.how, "cap_reduction"); assert.equal((up as { adjusted: number }).adjusted, 38000);
    const down = applyToLease(tradeEquity(true, 19000, appraisal({ allowanceSingle: 15000 }), NOW), 50000);
    assert.equal(down.how, "rolled_into_cap"); assert.equal((down as { adjusted: number }).adjusted, 54000);
  });
  it("compare ranks on post-trade OTD, so a big trade offset by a higher price can't hide", () => {
    const a = { eq: tradeEquity(true, 0, appraisal({ allowanceSingle: 20000 }), NOW), otdAfter: 0 }; a.otdAfter = otdBeforeAfter(52000, a.eq).after; // 32,000
    const b = { eq: tradeEquity(true, 0, appraisal({ allowanceSingle: 10000 }), NOW), otdAfter: 0 }; b.otdAfter = otdBeforeAfter(41000, b.eq).after; // 31,000
    assert.ok(compareByOtdAfterThenEquity(b, a) < 0, "lower post-trade OTD wins even with less equity");
    assert.ok(a.eq.net! > b.eq.net!, "but a still has the higher net equity, shown separately");
  });
});

describe("drafts, photos and the server-side six-photo rule", () => {
  let storage: ReturnType<typeof memoryStorage>;
  beforeEach(() => { storage = memoryStorage(); });
  const putObject = (key: string, size = 400_000, contentType = "image/jpeg") => storage.objects.set(key, { size, contentType });
  async function draftWithPhotos(slots: readonly PhotoSlot[], fields: object = goodFields()) {
    let d = await createDraft(storage, "u1");
    d = await saveDraftFields(storage, d, fields);
    for (const s of slots) {
      putObject(`trade/${d.id}/${s}.jpg`);
      d = await recordDraftPhoto(storage, d, await confirmPhoto(storage, { kind: "draft", id: d.id }, s, { width: 2048, height: 1536, capturedAt: "2026-10-08T14:05:09" }));
    }
    return d;
  }

  it("the draft link only works with its own token", async () => {
    const d = await createDraft(storage, "u1");
    assert.ok(verifyDraftToken(d.id, draftToken(d.id)));
    await assert.rejects(loadDraft(storage, d.id, "0".repeat(64)), (e: TradeError) => e.status === 403);
    await assert.rejects(loadDraft(storage, d.id, undefined), (e: TradeError) => e.status === 403);
  });
  it("the signed-in buyer's latest draft is findable on another device", async () => {
    const d = await createDraft(storage, "u1");
    const found = await latestDraftFor(storage, "u1");
    assert.equal(found?.draft.id, d.id);
    assert.equal(await latestDraftFor(storage, "someone-else"), null);
  });
  it("toggle OFF: no trade data, storage never touched", async () => {
    assert.equal(await prepareTradeForRfq(storage, {}, "u1"), null);
    assert.equal(await prepareTradeForRfq(storage, { tradeIn: { enabled: false, draftId: "x" } }, "u1"), null);
    assert.equal(await prepareTradeForRfq(storage, undefined, null), null);
    assert.equal(storage.json.size, 0);
  });
  it("toggle ON with 5 of 6 required photos is refused SERVER-SIDE (422), whatever the browser did", async () => {
    const d = await draftWithPhotos(REQUIRED_PHOTO_SLOTS.slice(0, 5));
    await assert.rejects(prepareTradeForRfq(storage, { tradeIn: { enabled: true, draftId: d.id, token: draftToken(d.id) } }, "u1"), (e: TradeError) => e.status === 422 && /interior|required/i.test(e.message));
  });
  it("a photo that's recorded but missing from storage doesn't count", async () => {
    const d = await draftWithPhotos(REQUIRED_PHOTO_SLOTS);
    storage.objects.delete(`trade/${d.id}/odometer.jpg`);
    await assert.rejects(prepareTradeForRfq(storage, { tradeIn: { draftId: d.id, token: draftToken(d.id) } }, "u1"), (e: TradeError) => e.status === 422);
  });
  it("toggle ON with incomplete fields is a 400 with field errors", async () => {
    const d = await draftWithPhotos(REQUIRED_PHOTO_SLOTS, { ...goodFields(), mileage: "" });
    await assert.rejects(prepareTradeForRfq(storage, { tradeIn: { draftId: d.id, token: draftToken(d.id) } }, "u1"), (e: TradeError) => e.status === 400 && Boolean(e.errors?.mileage));
  });
  it("six photos + valid fields pass, and adoption moves the photos under the request id", async () => {
    const d = await draftWithPhotos(REQUIRED_PHOTO_SLOTS);
    const ready = await prepareTradeForRfq(storage, { tradeIn: { enabled: true, draftId: d.id, token: draftToken(d.id) } }, "u1");
    assert.ok(ready);
    const rec = await adoptDraftIntoRfq(storage, ready!.draft, ready!.record, "42");
    assert.deepEqual(rec.photos.map((p) => p.storageKey).sort(), REQUIRED_PHOTO_SLOTS.map((s) => `trade/42/${s}.jpg`).sort());
    for (const p of rec.photos) assert.ok(await storage.head(p.storageKey));
    await assert.rejects(prepareTradeForRfq(storage, { tradeIn: { draftId: d.id, token: draftToken(d.id) } }, "u1"), (e: TradeError) => e.status === 409, "a draft can't be sent twice");
  });
  it("another account can't submit someone else's draft", async () => {
    const d = await draftWithPhotos(REQUIRED_PHOTO_SLOTS);
    await assert.rejects(prepareTradeForRfq(storage, { tradeIn: { draftId: d.id, token: draftToken(d.id) } }, "intruder"), (e: TradeError) => e.status === 403);
  });
  it("uploads: unknown slot, too-small, oversize and non-JPEG are all rejected and cleaned up", async () => {
    const d = await createDraft(storage, "u1");
    const scope = { kind: "draft" as const, id: d.id };
    await assert.rejects(presignPhotoUpload(storage, scope, "trunk"), (e: TradeError) => e.status === 400);
    putObject(`trade/${d.id}/front.jpg`);
    await assert.rejects(confirmPhoto(storage, scope, "front", { width: 800, height: 600 }), (e: TradeError) => e.status === 422);
    assert.equal(await storage.head(`trade/${d.id}/front.jpg`), null, "rejected object is deleted");
    putObject(`trade/${d.id}/rear.jpg`, 11 * 1024 * 1024);
    await assert.rejects(confirmPhoto(storage, scope, "rear", { width: 2048, height: 1536 }), (e: TradeError) => e.status === 413);
    putObject(`trade/${d.id}/odometer.jpg`, 1000, "image/png");
    await assert.rejects(confirmPhoto(storage, scope, "odometer", { width: 2048, height: 1536 }), (e: TradeError) => e.status === 415);
    await assert.rejects(confirmPhoto(storage, scope, "interior", { width: 2048, height: 1536 }), (e: TradeError) => e.status === 409, "never uploaded");
  });
  it("required photos can be replaced but not removed after sending; optional ones can", () => {
    const list = [...sixPhotos(), photo("damage_1")];
    assert.throws(() => withoutOptionalPhoto(list, "front"), TradeError);
    assert.equal(withoutOptionalPhoto(list, "damage_1").length, 6);
  });
});

describe("signed photo URLs and who may ask", () => {
  it("only a dealer invited on THIS request passes; other requests and bad tokens fail", () => {
    assert.ok(dealerMayViewTrade({ rfqId: "42" }, "42"));
    assert.ok(!dealerMayViewTrade({ rfqId: "43" }, "42"));
    assert.ok(!dealerMayViewTrade(null, "42"));
  });
  it("every photo URL is a short-lived signed GET (never a public key), labelled by slot", async () => {
    const storage = memoryStorage();
    const urls = await signTradePhotos(storage, sixPhotos());
    assert.equal(urls.length, 6);
    for (const u of urls) { assert.match(u.url, /^fake:\/\/get\/trade\/d\/[a-z_]+\.jpg\?exp=300$/); assert.equal(u.expiresInSeconds, 300); }
    assert.equal(urls[0].label, "Front");
  });
});

describe("value guide check", () => {
  it("flags only allowances more than 50% off the guide; skips without a guide", () => {
    assert.ok(isOutlier(30000, 18000)); assert.ok(isOutlier(8000, 18000));
    assert.ok(!isOutlier(20000, 18000)); assert.ok(!isOutlier(30000, 20000));
    assert.ok(!isOutlier(30000, null)); assert.ok(!isOutlier(30000, 0));
  });
});
