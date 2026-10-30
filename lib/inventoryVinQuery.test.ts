import "./testdata/blockLiveHttp";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { normalizeVinQuery, VIN_LENGTH_ERROR } from "./inventoryVinQuery";

describe("normalizeVinQuery", () => {
  it("uppercases and strips spaces, tabs and newlines", () => {
    assert.deepEqual(normalizeVinQuery("  1hgcm 82633a004352\n"), { ok: true, kind: "full", vin: "1HGCM82633A004352" });
  });
  it("a 17-character VIN is a full (exact) match", () => {
    const q = normalizeVinQuery("1HGCM82633A004352");
    assert.ok(q.ok && q.kind === "full");
  });
  it("6, 7 and 8 trailing characters are suffix matches", () => {
    for (const s of ["A004352", "a00435", "3A004352"]) {
      const q = normalizeVinQuery(s);
      assert.ok(q.ok && q.kind === "suffix", s);
      if (q.ok) assert.equal(q.vin, s.toUpperCase());
    }
  });
  it("rejects I, O and Q with a message naming the letters", () => {
    for (const bad of ["1HGCM82633A00435I", "A00O352", "q004352"]) {
      const q = normalizeVinQuery(bad);
      assert.equal(q.ok, false, bad);
      if (!q.ok) assert.match(q.error, /never contains [IOQ]/);
    }
    const two = normalizeVinQuery("IO12345");
    assert.ok(!two.ok && two.error.includes("I, O"));
  });
  it("rejects every other length, empty input and punctuation", () => {
    for (const bad of ["", "   ", "A0043", "A00435211", "1HGCM82633A0043521"]) {
      const q = normalizeVinQuery(bad);
      assert.deepEqual(q.ok ? null : q.error, VIN_LENGTH_ERROR, bad);
    }
    const p = normalizeVinQuery("A00-352");
    assert.ok(!p.ok && /letters and digits/.test(p.error));
  });
});
