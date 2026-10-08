// The picks bar and its hook, checked as source (there is no React test harness here): Clear picks exists next to Save picks,
// × and Clear persist the SAVED picks, nothing here opens a quote or sends anything, and guests use localStorage.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const view = fs.readFileSync(new URL("../components/BuyerSearchView.tsx", import.meta.url), "utf8");
const hook = fs.readFileSync(new URL("../components/search/useBuyerSearchState.ts", import.meta.url), "utf8");
const route = fs.readFileSync(new URL("../app/api/buyer/pick-status/route.ts", import.meta.url), "utf8");
const bar = view.slice(view.indexOf("function PicksBar("));

describe("the picks bar", () => {
  it("has a 'Clear picks' button right after 'Save picks', no confirm, calling clearPicks", () => {
    const iSave = bar.indexOf(">Save pic");
    const iClear = bar.indexOf(">Clear picks<");
    assert.ok(iSave > 0 && iClear > iSave, "Clear picks comes after Save picks");
    assert.match(bar.slice(iSave, iClear + 20), /onClick=\{\(\) => void state\.clearPicks\(\)\}/);
    assert.doesNotMatch(bar, /confirm\(|window\.confirm|<dialog|ConfirmModal/i, "clearing needs no confirmation");
  });
  it("Clear picks is only disabled when there is nothing at all to clear", () => {
    assert.match(bar, /disabled=\{!hasAnyPicks\}[^>]*>Clear picks/);
  });
  it("the × on each pick calls removePick", () => {
    assert.match(bar, /onClick=\{\(\) => void state\.removePick\(p\.key\)\}/);
  });
  it("shows the drop note ('N pick(s) removed — …') on its own full-width row, never inside the crowded status cluster", () => {
    assert.match(bar, /\{notice && \(\s*<p role="status"[^>]*data-testid="picks-notice" className="basis-full /);
    assert.doesNotMatch(bar, /notice \|\| status/);
  });
  it("the chip list wraps to its own line instead of shrinking below a chip's width (it used to overlap the status text)", () => {
    assert.match(bar, /<ul className="flex min-w-\[16rem\] flex-1 flex-wrap/);
    assert.doesNotMatch(bar, /<ul className="flex min-w-0 flex-1/);
  });
  it("only the Request a quote button opens a quote; the new controls never write a quote seed or navigate", () => {
    assert.equal((bar.match(/writeQuoteSeed\(/g) || []).length, 1);
    assert.equal((bar.match(/router\.push\(/g) || []).length, 1);
    assert.match(bar, /const requestQuote = \(\) => \{[\s\S]*?router\.push\("\/\?quote=1"\);\s*\};/);
    assert.doesNotMatch(hook, /writeQuoteSeed|router|\/\?quote|\/api\/rfq|\/api\/deals|mailto:|sendEmail/i, "the hook never opens or sends a quote");
  });
  it("the 3-pick limit message is unchanged", () => {
    assert.match(bar, /You can pick up to 3 vehicles\. Remove one to add another\./);
  });
});

describe("useBuyerSearchState", () => {
  it("guests use localStorage (and migrate the old sessionStorage copy once); signed-in buyers also use the account store", () => {
    assert.match(hook, /const storeFor = \(\) => \(userId \? \{ store: ls\(\), key: userKey\(userId\) \} : \{ store: ls\(\), key: GUEST_KEY \}\)/);
    assert.match(hook, /function migrateGuest\(\)/);
    assert.match(hook, /if \(!userId\) migrateGuest\(\)/);
    assert.match(hook, /\/api\/buyer\/search-state/);
  });
  it("× and Clear write the SAVED picks straight away (local + account), not only on the next Save", () => {
    const rm = hook.slice(hook.indexOf("const removePick"), hook.indexOf("return { ready"));
    assert.match(rm, /removeKey\(savedRef\.current, key\)/);
    assert.match(rm, /await persistSaved\(nextSaved\)/);
    const cl = hook.slice(hook.indexOf("const clearPicks"), hook.indexOf("const removePick"));
    assert.match(cl, /setSavedPicks\(\[\]\); savedRef\.current = \[\]/);
    assert.match(cl, /await persistSaved\(\[\]\)/);
  });
  it("persistSaved writes local always and the account only for a signed-in buyer, with PUT {picks}", () => {
    const ps = hook.slice(hook.indexOf("const persistSaved"), hook.indexOf("// Load once"));
    assert.match(ps, /write\(store, key,/);
    assert.match(ps, /if \(!userId\) return true;/);
    assert.match(ps, /method: "PUT"[\s\S]*JSON\.stringify\(\{ picks: next \}\)/);
  });
  it("on load: expiry via reconcileLoaded, then the still-listed check, then the cleaned list is written back", () => {
    assert.match(hook, /reconcileLoaded\(\{ local, server, now \}\)/);
    assert.match(hook, /await checkListed\(r\.state\.picks\)/);
    assert.match(hook, /dropGone\(r\.state\.picks, listing\)/);
    assert.match(hook, /pickNotice\(\{ gone: gone\.length, expired: r\.expired\.length \}\)/);
    assert.match(hook, /write\(store, key, \{ picks: live,/);
  });
  it("a failed stock check keeps every pick", () => {
    assert.match(hook, /catch \{ return \{\}; \}/);
    assert.match(hook, /if \(!res\.ok\) return \{\};/);
  });
});

describe("/api/buyer/pick-status", () => {
  it("is read-only: it calls inventoryVin and never writes, sends or opens anything", () => {
    assert.match(route, /inventoryVin\(vin\)/);
    assert.doesNotMatch(route, /bulkUpsertInventory|sweepInventory|putBuyerSearchState|fetch\(.*method: "(PUT|POST|DELETE)"|sendEmail|writeQuoteSeed/);
  });
  it("answers unknown for any pick whose lookup fails, and caps the request at 3 picks", () => {
    assert.match(route, /status\[key\] = "unknown"/);
    assert.match(route, /slice\(0, MAX_PICKS\)/);
  });
});

// ---- results layout: the picks bar must not cover rows; wide tables scroll sideways; column order is locked ------------------------
describe("results layout", () => {
  const table = view.slice(view.indexOf("function VehicleTable("), view.indexOf("const pickLabel"));
  it("LOCKED column order: pick, days, vehicleId, vin, year, make, model, trim, ext, int, mileage, price, dealer, state, contact, listing, then distance (ZIP search only, always last)", () => {
    const block = view.slice(view.indexOf("const TABLE_COLUMNS"), view.indexOf("const ROW_H"));
    const keys = [...block.matchAll(/\{ key: "(\w+)"/g)].map((m) => m[1]);
    assert.deepEqual(keys, ["pick", "days", "vehicleId", "vin", "year", "make", "model", "trim", "ext", "int", "mileage", "price", "dealer", "state", "contact", "listing", "distance"]);
  });
  it("the header row and every body row render the same filtered column list, in that order", () => {
    assert.equal((table.match(/\{cols\.map\(\(c\) =>/g) || []).length, 2, "header and body both map the same cols");
    assert.match(table, /const cols = TABLE_COLUMNS\.filter\(\(c\) => c\.key !== "distance" \|\|/);
  });
  it("the page pads its bottom by the picks bar's measured height (no fixed pb-28 guess)", () => {
    assert.match(view, /style=\{\{ paddingBottom: "calc\(var\(--picks-bar-h, 7rem\) \+ 1\.5rem\)" \}\}/);
    assert.doesNotMatch(view, /max-w-7xl px-4 py-8 pb-28/);
  });
  it("the bar publishes --picks-bar-h from its real height, updates it on resize, and cleans up", () => {
    assert.match(bar, /setProperty\("--picks-bar-h"/);
    assert.match(bar, /new ResizeObserver\(publish\)/);
    assert.match(bar, /removeProperty\("--picks-bar-h"\)/);
    assert.match(bar, /<div ref=\{bar\} className="fixed inset-x-0 bottom-0/);
  });
  it("the results scroller sits above the bar: its height is capped by the viewport minus its own top minus the bar", () => {
    assert.match(table, /calc\(100dvh - var\(--table-top, 260px\) - var\(--picks-bar-h, 7rem\)/);
    assert.match(table, /setProperty\("--table-top"/);
    assert.match(table, /window\.addEventListener\("resize", measure\)/);
  });
  it("it scrolls sideways when the columns overflow, with nothing clipping the right edge: full-width inner content, columns do not shrink", () => {
    assert.match(table, /className="overflow-x-auto overflow-y-auto overscroll-x-contain"/);
    assert.match(table, /style=\{\{ width: totalW, minWidth: "100%" \}\}/);
    assert.ok((table.match(/shrink-0/g) || []).length >= 2, "header and body cells are shrink-0");
    assert.match(table, /const totalW = cols\.reduce\(\(s, c\) => s \+ c\.w, 0\)/);
  });
  it("the header stays sticky inside the scroller", () => {
    assert.match(table, /className="sticky top-0 z-20 flex border-b/);
  });
  it("the checkbox column is first and a short spacer follows the last row so overlay scrollbars never hide it", () => {
    assert.ok(table.indexOf('aria-label={`Pick ') > 0);
    assert.match(table, /<div aria-hidden style=\{\{ height: 10 \}\} \/>/);
  });
});
