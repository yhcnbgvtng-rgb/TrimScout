import assert from "node:assert/strict";
import { describe, it } from "node:test";
import fs from "node:fs";
import { quoteIntroEnabled } from "./quoteIntroFlag";

describe("quoteIntroEnabled", () => {
  it("is off in Production and locally by default", () => {
    assert.equal(quoteIntroEnabled({ vercelEnv: "production" }), false);
    assert.equal(quoteIntroEnabled({}), false);
  });
  it("is on in previews", () => assert.equal(quoteIntroEnabled({ vercelEnv: "preview" }), true));
  it("can be forced on or off", () => {
    assert.equal(quoteIntroEnabled({ forced: "1", vercelEnv: "production" }), true);
    assert.equal(quoteIntroEnabled({ forced: "0", vercelEnv: "preview" }), false);
  });
  it("keeps the intro small and library-free", () => {
    const src = fs.readFileSync(new URL("../components/QuoteIntro.tsx", import.meta.url), "utf8");
    assert.ok(src.length < 30 * 1024);
    assert.doesNotMatch(src, /from "(?!react")/);
  });
});
