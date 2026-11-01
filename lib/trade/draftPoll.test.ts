import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { DRAFT_POLL_BASE_MS, DRAFT_POLL_MAX_MS, nextPollDelay, photosSignature } from "./draftPoll";

describe("trade draft polling pace", () => {
  it("starts at the base gap and doubles while nothing changes", () => {
    assert.equal(nextPollDelay(0), DRAFT_POLL_BASE_MS);
    assert.equal(nextPollDelay(1), DRAFT_POLL_BASE_MS * 2);
    assert.equal(nextPollDelay(2), DRAFT_POLL_BASE_MS * 4);
  });
  it("never exceeds the cap, however long it stays quiet", () => {
    assert.equal(nextPollDelay(50), DRAFT_POLL_MAX_MS);
    assert.equal(nextPollDelay(1_000_000), DRAFT_POLL_MAX_MS);
  });
  it("a few minutes of quiet is a handful of calls, not hundreds", () => {
    let elapsed = 0, calls = 0, quiet = 0;
    while (elapsed < 5 * 60_000) { elapsed += nextPollDelay(quiet++); calls++; }
    assert.ok(calls <= 10, `${calls} calls in 5 minutes`);
  });
  it("junk input falls back to the base gap", () => {
    assert.equal(nextPollDelay(-3), DRAFT_POLL_BASE_MS);
    assert.equal(nextPollDelay(NaN as number), DRAFT_POLL_BASE_MS);
  });
  it("the photo signature changes when a photo is added or replaced, not on reorder", () => {
    const a = { slot: "front", storageKey: "k1", uploadedAt: "t1" }, b = { slot: "rear", storageKey: "k2", uploadedAt: "t2" };
    assert.equal(photosSignature([a, b]), photosSignature([b, a]));
    assert.notEqual(photosSignature([a]), photosSignature([a, b]));
    assert.notEqual(photosSignature([a]), photosSignature([{ ...a, uploadedAt: "t9" }]));
  });
});
