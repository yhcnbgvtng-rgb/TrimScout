import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), "utf8");

describe("SiteFooter — shared feedback line (2026-09-19)", () => {
  it("renders the exact feedback copy as a mailto link, alongside the legal links", () => {
    const src = read("components/SiteFooter.tsx");
    // Exact copy, one line.
    assert.match(src, /Feedback\? Bugs\? Issues\? Email us at/);
    // Real mailto link with real link text (not "click here").
    assert.match(src, /href="mailto:general@trimscout\.com"/);
    assert.match(src, />general@trimscout\.com<\/a>/);
    assert.doesNotMatch(src, /click here/i);
    // Terms / Privacy links are kept, not replaced.
    assert.match(src, /href="\/terms"/);
    assert.match(src, /href="\/privacy"/);
    // Muted footer tokens, no new brand colors.
    assert.match(src, /text-ink-faint/);
    // Entity attribution stays LyDar Enterprises LLC.
    assert.match(src, /LyDar Enterprises LLC/);
  });

  it("is used on the key buyer routes (homepage, quote-request flow) and the legal pages", () => {
    for (const rel of [
      "app/page.tsx",
      "app/rfq/[id]/page.tsx",
      "app/quote-request/received/page.tsx",
      "app/terms/page.tsx",
      "app/privacy/page.tsx",
      "app/disclaimer/page.tsx",
      "app/contact/page.tsx",
    ]) {
      const src = read(rel);
      assert.match(src, /import \{ SiteFooter \}/, `${rel} imports SiteFooter`);
      assert.match(src, /<SiteFooter/, `${rel} renders SiteFooter`);
    }
  });

  it("terms and privacy pages reference LyDar Enterprises LLC", () => {
    assert.match(read("app/terms/page.tsx"), /LyDar Enterprises LLC/);
    assert.match(read("app/privacy/page.tsx"), /LyDar Enterprises LLC/);
  });
});
