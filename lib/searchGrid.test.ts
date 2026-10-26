// The /search results grid's rules: which columns exist and in what order, what a cell shows, the pills, the cols= URL param,
// the list-search rule and the slider mapping. Pure, no React.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { classifyDrivetrain, classifyFuel, classifyTransmission } from "../scrapers/lightsail-crawler/src/inventoryDerived.js";
import { buildPills, cellText, clearColumn, columnActive, columnSent, filterListRows, GRID_COLUMNS, paidOptionsOf, rangeFromSlider, visibleColumnsFromParam, visibleColumnsToParam } from "./searchGrid";
import { filtersFromSearchParams, urlWithFilters, type UrlFilters } from "./searchUrlState";

const empty: UrlFilters = {
  state: "", make: "", model: "", trim: "", cond: "", priceMin: "", priceMax: "", yearMin: "", yearMax: "", odometerMax: "", exteriorColor: "", interiorColor: "", optionKeys: [],
  possibleDemo: false, contactOnFile: false, zip: "", radiusMiles: "", sort: "", exclude: "", odometerMin: "", bodyStyle: [], fuel: [], drivetrain: [], transmission: [], dealerIds: [], daysMin: "", daysMax: "", vinPattern: "",
};

describe("columns", () => {
  it("are the 17 asked for, in that order, with the VIN as an opt-in extra", () => {
    assert.deepEqual(GRID_COLUMNS.map((c) => c.key), ["year", "make", "model", "trim", "condition", "ext", "int", "mileage", "price", "paid", "body", "fuel", "drive", "trans", "dealer", "state", "days", "vin"]);
    assert.deepEqual(GRID_COLUMNS.filter((c) => c.defaultHidden).map((c) => c.key), ["vin"]);
  });
  it("only columns the box can order by have a sort toggle", () => {
    assert.deepEqual(GRID_COLUMNS.filter((c) => !c.sort).map((c) => c.key), ["condition", "paid", "body", "fuel", "drive", "trans"]);
  });
  it("every column has a filter", () => {
    assert.ok(GRID_COLUMNS.every((c) => c.filter));
  });
});

describe("the cols= param", () => {
  it("is empty for the defaults and round-trips what the shopper changed", () => {
    assert.equal(visibleColumnsToParam(visibleColumnsFromParam(null)), "");
    const v = visibleColumnsFromParam("-year,-days,+vin");
    assert.ok(!v.includes("year") && !v.includes("days") && v.includes("vin"));
    assert.equal(visibleColumnsToParam(v), "-year,-days,+vin");
  });
  it("drops unknown names and keeps the fixed order", () => {
    assert.deepEqual(visibleColumnsFromParam("-nope,+alsono,*make"), visibleColumnsFromParam(null));
  });
});

describe("cells", () => {
  const row = { year: 2025, make: "Ford", model: "F-150", trim: "XLT 4x4", condition: "cpo" as const, mileage: 12345, price: 41999, engine: "3.5L V6 EcoBoost", transmission: "10-Speed Automatic", bodyStyle: "Pickup", dealerName: "Metro Ford", dealerState: "FL", daysOnLot: 12, vin: "1FT" };
  it("formats numbers and conditions", () => {
    assert.equal(cellText("price", row), "$41,999");
    assert.equal(cellText("mileage", row), "12,345");
    assert.equal(cellText("condition", row), "Certified");
    assert.equal(cellText("days", row), "12");
  });
  it("derives fuel, drivetrain and transmission with the box's own classifier, so a cell and its filter agree", () => {
    assert.equal(cellText("fuel", row), "Gas");
    assert.equal(cellText("drive", row), "AWD / 4WD");
    assert.equal(cellText("trans", row), "Automatic");
    for (const r of [row, { ...row, trim: "Lightning", engine: "Electric Motor" }, { ...row, trim: "Hybrid FWD" }, { ...row, engine: null, transmission: "CVT" }]) {
      assert.equal(cellText("fuel", r) === "", classifyFuel({ trim: r.trim, engine: r.engine, model: r.model }) == null);
      assert.equal(cellText("drive", r) === "", classifyDrivetrain({ trim: r.trim, engine: r.engine, bodyStyle: r.bodyStyle }) == null);
      assert.equal(cellText("trans", r) === "", classifyTransmission({ transmission: r.transmission }) == null);
    }
  });
  it("never guesses: text that says nothing leaves the cell blank", () => {
    assert.equal(cellText("drive", { ...row, trim: "XL", engine: "2.7L", bodyStyle: "Pickup" }), "");
    assert.equal(cellText("fuel", { ...row, engine: null }), "");
  });
  it("Paid options counts only factory rows priced above $0, once each", () => {
    const options = [
      { name: "Tow Package", price: 650, kind: "factory" }, { name: "Tow Package", price: 650, kind: "factory" },
      { name: "Floor Mats", price: 0, kind: "factory" }, { name: "Nerf Bars", price: 400, kind: "dealer" }, { name: "Roof", price: 1200 },
    ];
    assert.deepEqual(paidOptionsOf({ options }).map((o) => o.name), ["Tow Package", "Roof"]);
    assert.equal(cellText("paid", { options }), "2");
    assert.equal(cellText("paid", { options: [{ name: "Mats", price: 0 }] }), "");
    assert.equal(cellText("paid", {}), "");
  });
});

describe("a column the box does not send is hidden", () => {
  it("hidden when no loaded row carries the field; shown when the field is present even if empty; everything shows with no rows yet", () => {
    assert.equal(columnSent("body", [{ year: 2025 }, { year: 2024 }]), false);
    assert.equal(columnSent("body", [{ bodyStyle: null }]), true);
    assert.equal(columnSent("paid", [{ options: undefined }]), false);
    assert.equal(columnSent("body", []), true);
  });
});

describe("pills", () => {
  it("one per picked value, removing exactly that value", () => {
    const f: UrlFilters = { ...empty, make: "Ford", model: "F-150", fuel: ["gas", "hybrid"], dealerIds: ["12"], priceMin: "20000", priceMax: "40000", optionKeys: ["tow"], exclude: "demo, loaner" };
    const pills = buildPills(f, { dealers: { "12": "Metro Ford" }, options: { tow: "Tow Package" } });
    const labels = pills.map((p) => p.label);
    assert.deepEqual(labels, ["Make: Ford", "Model: F-150", "Price: $20,000–$40,000", "Option: Tow Package", "Fuel: Gas", "Fuel: Hybrid", "Dealer: Metro Ford", "Leave out: demo", "Leave out: loaner"]);
    const gas = pills.find((p) => p.label === "Fuel: Gas")!;
    assert.deepEqual(gas.clear(f).fuel, ["hybrid"]);
    assert.equal(pills.find((p) => p.label === "Leave out: demo")!.clear(f).exclude, "loaner");
  });
  it("removing the make takes model, trim and options with it", () => {
    const f: UrlFilters = { ...empty, make: "Ford", model: "F-150", trim: "XLT", optionKeys: ["tow"] };
    const next = buildPills(f)[0].clear(f);
    assert.deepEqual([next.make, next.model, next.trim, next.optionKeys], ["", "", "", []]);
    assert.equal(clearColumn("price", { ...f, priceMin: "1" }).priceMin, "");
  });
  it("open-ended ranges read naturally and there is nothing for an empty filter set", () => {
    assert.equal(buildPills({ ...empty, odometerMax: "30000" })[0].label, "Mileage: up to 30,000");
    assert.equal(buildPills({ ...empty, yearMin: "2023" })[0].label, "Year: 2023+");
    assert.deepEqual(buildPills(empty), []);
  });
  it("columnActive follows the same fields", () => {
    assert.equal(columnActive("days", { ...empty, daysMax: "30" }), true);
    assert.equal(columnActive("days", empty), false);
  });
});

describe("list search", () => {
  const rows = [{ value: "a", label: "Alpha", count: 4 }, { value: "b", label: "Beta", count: 0 }, { value: "c", label: "Gamma" }];
  it("hides zero-count rows, keeps rows without a count, and filters by what was typed", () => {
    assert.deepEqual(filterListRows(rows, "", []).map((r) => r.value), ["a", "c"]);
    assert.deepEqual(filterListRows(rows, "AL", []).map((r) => r.value), ["a"]);
  });
  it("keeps a picked row visible even at zero so it can be unticked", () => {
    assert.deepEqual(filterListRows(rows, "", ["b"]).map((r) => r.value), ["a", "b", "c"]);
  });
});

describe("slider", () => {
  it("a handle at the end of the track means no bound", () => {
    assert.deepEqual(rangeFromSlider(0, 150000, { min: 0, max: 150000 }), { min: "", max: "" });
    assert.deepEqual(rangeFromSlider(20000, 60000, { min: 0, max: 150000 }), { min: "20000", max: "60000" });
  });
});

describe("days on market in the URL", () => {
  it("reads the free range, and an old days=8-30 link into it", () => {
    assert.deepEqual([filtersFromSearchParams(new URLSearchParams("make=Ford&daysMin=5&daysMax=40"), empty).daysMin, filtersFromSearchParams(new URLSearchParams("make=Ford&daysMin=5&daysMax=40"), empty).daysMax], ["5", "40"]);
    const old = filtersFromSearchParams(new URLSearchParams("make=Ford&days=8-30"), empty);
    assert.deepEqual([old.daysMin, old.daysMax], ["8", "30"]);
    const open = filtersFromSearchParams(new URLSearchParams("make=Ford&days=91%2B"), empty);
    assert.deepEqual([open.daysMin, open.daysMax], ["91", ""]);
  });
  it("writes only the new params and drops a stale days=", () => {
    const url = urlWithFilters("http://x/search?days=8-30&cols=-year", { ...empty, make: "Ford", daysMin: "8", daysMax: "30" });
    const sp = new URL(url).searchParams;
    assert.equal(sp.has("days"), false);
    assert.equal(sp.get("daysMin"), "8");
    assert.equal(sp.get("cols"), "-year"); // view state is left alone
  });
});
