import assert from "node:assert/strict";
import { describe, it } from "node:test";
import fs from "node:fs";
import { quoteIntroEnabled } from "./quoteIntroFlag";

describe("quoteIntroEnabled", () => {
  it("is on by default, in Production and previews alike", () => {
    assert.equal(quoteIntroEnabled({}), true);
    assert.equal(quoteIntroEnabled({ forced: "1" }), true);
  });
  it("can be forced off", () => assert.equal(quoteIntroEnabled({ forced: "0" }), false));
  it("keeps the intro small and library-free", () => {
    const src = fs.readFileSync(new URL("../components/QuoteIntro.tsx", import.meta.url), "utf8");
    assert.ok(src.length < 30 * 1024);
    assert.doesNotMatch(src, /from "(?!react")/);
  });
});
