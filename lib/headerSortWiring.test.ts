// The /search column-header sort, checked as source (no React harness): clickable headers with an arrow on the sorted column,
// the click cycle, the guard rails, the request it sends, and that the sort survives filter changes and paging.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const view = fs.readFileSync(new URL("../components/BuyerSearchView.tsx", import.meta.url), "utf8");
const table = view.slice(view.indexOf("function VehicleTable("), view.indexOf("const pickLabel"));
const page = view.slice(view.indexOf("export function BuyerSearchView"), view.indexOf("const money ="));
const qs = view.slice(view.indexOf("function filtersToQueryString"), view.indexOf("const RESULTS_PAGE_SIZE"));

describe("headers", () => {
  it("every sortable column header is a button that calls onSort with its column key; the checkbox column is plain text", () => {
    assert.match(table, /const sortable = isSortableColumn\(c\.key\);/);
    assert.match(table, /onClick=\{\(\) => onSort\(c\.key as SortableColumn\)\}/);
    assert.match(table, /\) : \(\s*<span className="truncate px-2\.5">\{c\.label\}<\/span>/, "non-sortable fallback");
  });
  it("the header cell carries aria-sort and the sorted one shows an up or down arrow", () => {
    assert.match(table, /role="columnheader" aria-sort=\{sortable \? ariaSortFor\(sort, c\.key\) : undefined\}/);
    assert.match(table, /here\.dir === "asc" \? <ArrowUp [^>]*data-testid="sort-arrow-asc"/);
    assert.match(table, /<ArrowDown [^>]*data-testid="sort-arrow-desc"/);
    assert.match(table, /const here = sortable && active\?\.column === c\.key \? active : null;/);
  });
  it("the header is a keyboard-focusable button with a tooltip naming the next click, and is disabled while a search runs", () => {
    assert.match(table, /title=\{`Sort by \$\{c\.label\} — click for/);
    assert.match(table, /disabled=\{sortBusy\}/);
  });
  it("the sticky header and the locked column order are untouched", () => {
    assert.match(table, /className="sticky top-0 z-20 flex border-b/);
    assert.equal((table.match(/\{cols\.map\(\(c\) =>/g) || []).length, 2);
  });
});

describe("the click", () => {
  const onSort = page.slice(page.indexOf("const onSort ="), page.indexOf("const toggleOptionKey"));
  it("uses the three-step cycle on the applied sort and ignores clicks while loading or before a first search", () => {
    assert.match(onSort, /if \(!applied \|\| searchLoading\) return;/);
    assert.match(onSort, /const next = nextSort\(applied\.sort, column\);/);
  });
  it("a slow sort (every column but dealer/make/VIN/contact/distance) needs a model first: a note, and NO request", () => {
    assert.match(onSort, /sortBlockedReason\(column, Boolean\(applied\.model\), label\)/);
    assert.match(onSort, /if \(why\) \{ setSortNote\(why\); return; \}/);
  });
  it("applies the sort to the search already on screen (applied + the draft's sort), re-running it from the first page", () => {
    assert.match(onSort, /setFilters\(\(f\) => \(\{ \.\.\.f, sort: next \}\)\)/);
    assert.match(onSort, /setApplied\(\(a\) => \(a \? \{ \.\.\.a, sort: next \} : a\)\)/);
    assert.match(page, /useEffect\(\(\) => \{\s*if \(!applied\) return;\s*void runSearch\(applied, 0\);/);
  });
  it("remembers the previous sort so a failed or timed-out sort can be put back", () => {
    assert.match(onSort, /sortAttemptRef\.current = next \? \{ prev: applied\.sort, label \} : null;/);
  });
});

describe("a sort that fails is undone, not left blank", () => {
  it("on a non-OK response or a network error for a header sort: previous sort restored, old results kept, a plain note shown", () => {
    const run = page.slice(page.indexOf("const runSearch = useCallback"), page.indexOf("// Runs the search for whatever Search last committed"));
    assert.equal((run.match(/setSortNote\(SORT_TIMEOUT_NOTE\(attempt\.label\)\)/g) || []).length, 2, "both the HTTP-error and the network-error paths");
    assert.equal((run.match(/sort: attempt\.prev/g) || []).length, 4, "filters and applied are both restored, in both paths");
    assert.match(run, /const attempt = sortAttemptRef\.current;\s*if \(attempt && offset === 0\) \{/);
    assert.match(run, /sortAttemptRef\.current = null;\s*setSearchError\(null\);\s*const lastPageCount/, "a successful search clears the pending attempt");
  });
  it("the note is shown above the table", () => {
    assert.match(page, /\{sortNote && <p role="status" data-testid="sort-note"/);
  });
});

describe("the request", () => {
  it("sends sort=…, and nullsLast=1 with every explicit sort except Distance (which has no database column)", () => {
    assert.match(qs, /if \(f\.sort\) \{\s*sp\.set\("sort", f\.sort\);/);
    assert.match(qs, /if \(parseSort\(f\.sort\)\?\.key !== "distance"\) sp\.set\("nullsLast", "1"\);/);
  });
  it("with no sort nothing extra is sent (the tuned default order is untouched)", () => {
    assert.doesNotMatch(qs, /sp\.set\("nullsLast", "1"\);\s*\n\s*if \(extra/);
  });
});

describe("the sort sticks", () => {
  it("through paging: Load more re-runs the SAME applied filters (sort included) from where the list ended", () => {
    assert.match(page, /void runSearch\(applied, results\.vehicles\.length\);/);
  });
  it("through filter changes: Search commits the draft, which already carries the sort", () => {
    assert.match(page, /setApplied\(\{ \.\.\.filters \}\);/);
  });
  it("'Clear more filters' keeps the header sort (only a Distance sort goes, with the ZIP), and the More badge no longer counts it", () => {
    assert.match(page, /sort: parseSort\(f\.sort\)\?\.key === "distance" \? "" : f\.sort,/);
    const count = view.slice(view.indexOf("function countMoreFilters"), view.indexOf("function countMoreFilters") + 400);
    assert.doesNotMatch(count, /f\.sort/);
  });
  it("a fresh Search clears an old sort note", () => {
    assert.match(page, /setMoreOpen\(false\);\s*setSortNote\(null\);/);
  });
});
