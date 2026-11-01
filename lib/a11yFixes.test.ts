import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import { nextFocusIndex } from "./focusTrap";

const require = createRequire(import.meta.url);
const tw = require("../tailwind.config.js");
const colors = tw.theme.extend.colors;
const css = fs.readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

const lum = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };

describe("placeholder contrast", () => {
  const faint = colors.ink.faint as string;
  for (const [name, bg] of [["page", "#090a0f"], ["surface", colors.surface], ["surface-elevated", colors["surface-elevated"]]] as const) {
    it(`placeholder-ink-faint is at least 4.5:1 on ${name}`, () => assert.ok(ratio(faint, bg) >= 4.5, `${ratio(faint, bg).toFixed(2)}:1`));
  }
  it("the global .text-ink-faint override matches the token", () => assert.match(css, new RegExp(`\\.text-ink-faint\\s*{\\s*color:\\s*${faint}`, "i")));
});

describe("Request a Quote focus ring", () => {
  it("is an explicit light outline on the green buttons, never the black default", () => {
    const rule = css.match(/\[data-testid\^="cta-request-quote"\]:focus-visible\s*{([^}]*)}/);
    assert.ok(rule, "rule exists");
    assert.match(rule![1], /outline:\s*3px solid #ffffff/i);
    assert.ok(ratio("#ffffff", "#090a0f") >= 3 && ratio("#ffffff", colors.brand[500]) >= 3);
  });
});

describe("wizard focus containment", () => {
  it("Tab wraps from the last element to the first, Shift+Tab from the first to the last", () => {
    assert.equal(nextFocusIndex(5, 4, false), 0);
    assert.equal(nextFocusIndex(5, 0, true), 4);
    assert.equal(nextFocusIndex(5, 2, false), 3);
    assert.equal(nextFocusIndex(5, 2, true), 1);
  });
  it("focus outside the dialog (-1) is pulled to an end; an empty dialog has nowhere to go", () => {
    assert.equal(nextFocusIndex(5, -1, false), 0);
    assert.equal(nextFocusIndex(5, -1, true), 4);
    assert.equal(nextFocusIndex(0, -1, false), -1);
  });
});
