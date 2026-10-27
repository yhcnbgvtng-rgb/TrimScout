// A picked filter must stay readable in its box: the box sizes to its text (clamped), the search icon and × are gone once
// there is a value, and a multi-select reads "Chevrolet +2".
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import SearchableDropdown from "../components/search/SearchableDropdown";
import { fitWidth, FIT_MAX_REM, FIT_MIN_REM } from "../components/search/fitWidth";

const opts = [
  { value: "chevrolet", label: "Chevrolet", count: 40 },
  { value: "ford", label: "Ford", count: 30 },
  { value: "toyota", label: "Toyota", count: 20 },
];
(globalThis as { React?: unknown }).React = React; // the components use the classic JSX runtime
const noop = () => {};
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const dd = (extra: Record<string, unknown>) => React.createElement(SearchableDropdown as any, { label: "Make", placeholder: "Any make", options: opts, onChange: noop, ...extra });

describe("fitWidth", () => {
  it("grows with the text between a min and a max", () => {
    assert.equal(fitWidth("Texas"), `clamp(${FIT_MIN_REM}rem, calc(5ch + 3.25rem), ${FIT_MAX_REM}rem)`);
    assert.ok(fitWidth("a much longer value").includes("19ch"));
  });
});

describe("SearchableDropdown with a value", () => {
  it("shows the value in full, no search icon, no clear ×, and sizes to content when fit", () => {
    const html = renderToStaticMarkup(dd({ fit: true, value: "chevrolet" }));
    assert.match(html, /value="Chevrolet · 40"/);
    assert.doesNotMatch(html, /lucide-search/);
    assert.doesNotMatch(html, /Clear Make/);
    assert.match(html, /width:clamp\(/);
  });
  it("keeps the search icon while empty", () => {
    const html = renderToStaticMarkup(dd({ value: "" }));
    assert.match(html, /lucide-search/);
    assert.doesNotMatch(html, /width:clamp\(/);
  });
  it("multi-select reads 'Chevrolet +2'", () => {
    const html = renderToStaticMarkup(dd({ multi: true, value: ["chevrolet", "ford", "toyota"] }));
    assert.match(html, /value="Chevrolet \+2 · 20"/);
    const one = renderToStaticMarkup(dd({ multi: true, value: ["ford"] }));
    assert.match(one, /value="Ford · 30"/);
  });
});
