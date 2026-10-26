// The buyer /search "More filters": the text classifiers (fuel, drivetrain, transmission), the list-query predicates, the VIN pattern, and the facet counts.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  PATTERNS, FUEL_SQL, DRIVETRAIN_SQL, TRANSMISSION_SQL, classifyDrivetrain, classifyFuel, classifyTransmission,
  bodyStylesOf, dealerIdsOf, vinPatternPlan, cleanVinPattern, cleanFuel,
} from "../src/inventoryDerived.js";
import { inventoryListQuery } from "../src/inventoryListQuery.js";
import { DAYS_BANDS, MILEAGE_BUCKETS, bandOfDays, buildFacetCountsResponse, createTtlCache, facetRowsSql, facetedFiltersOf, foldFacetCounts, paramsWithoutFaceted, rowCapOf } from "../src/facetCounts.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const q = (s) => inventoryListQuery(new URLSearchParams(s));

describe("fuel type, read from the text", () => {
  const cases = [
    [{ trim: "XSE Hybrid", engine: "2.5L" }, "hybrid"], [{ trim: "SE Prime", engine: "2.5L" }, "phev"], [{ model: "F-150 Lightning", engine: "" }, "electric"],
    [{ trim: "Lariat", engine: "3.5L V6 EcoBoost" }, "gas"], [{ trim: "Limited", engine: "6.7L Power Stroke Diesel" }, "diesel"], [{ trim: "LE" }, null],
    [{ trim: "350h" }, "hybrid"], [{ trim: "Premium Plus", model: "Q5", engine: "2.0L TFSI e" }, "phev"], [{ model: "Ioniq 5", trim: "SE" }, "electric"],
    [{ model: "Prius Primera", engine: "1.8L" }, "gas"], // "Prime" inside a longer word is not a plug-in
    [{ trim: "Equinox EV 2LT" }, "electric"], [{ trim: "xDrive50e" }, "phev"],
  ];
  for (const [row, want] of cases) it(`${JSON.stringify(row)} -> ${want}`, () => assert.equal(classifyFuel(row), want));
});
describe("drivetrain, read from the trim text", () => {
  const cases = [
    [{ trim: "XLT 4x4" }, "awd"], [{ trim: "Limited", engine: "3.5L V6 AWD" }, "awd"], [{ trim: "xDrive40i" }, "awd"], [{ trim: "Premium quattro" }, "awd"], [{ trim: "SR5 RWD" }, "rwd"],
    [{ trim: "sDrive40i" }, "rwd"], [{ trim: "Premium FWD" }, "fwd"], [{ trim: "LE" }, null], [{ trim: "Lariat", bodyStyle: "SUV" }, null], [{ trim: "Lariat", bodyStyle: "SUV 4WD" }, "awd"],
  ];
  for (const [row, want] of cases) it(`${JSON.stringify(row)} -> ${want}`, () => assert.equal(classifyDrivetrain(row), want));
});
describe("transmission, grouped from the text", () => {
  const cases = [
    ["8-Speed Automatic with manual shift", "automatic"], ["6-Speed Manual", "manual"], ["CVT Automatic", "cvt"], ["Single-Speed Direct Drive", "single"],
    ["7-Speed PDK Dual Clutch", "dct"], ["8-Speed", null], [null, null], ["10-Speed A/T", "automatic"], ["Tiptronic", "automatic"],
  ];
  for (const [t, want] of cases) it(`${t} -> ${want}`, () => assert.equal(classifyTransmission({ transmission: t }), want));
});
describe("the SQL is built from the same patterns", () => {
  it("every pattern appears, with backslashes doubled for the SQL string and no stray quotes or placeholders", () => {
    for (const sql of [FUEL_SQL, DRIVETRAIN_SQL, TRANSMISSION_SQL]) {
      assert.ok(!sql.includes("?"), "a pattern put a placeholder character in the SQL");
      assert.equal((sql.match(/'/g) || []).length % 2, 0);
      assert.match(sql, /^\(CASE WHEN .* END\)$/);
    }
    for (const k of ["awd", "rwd", "fwd"]) assert.ok(DRIVETRAIN_SQL.includes(PATTERNS[k].replace(/'/g, "''")), k);
    for (const k of ["phev", "hybrid", "electric", "diesel"]) assert.ok(FUEL_SQL.includes(PATTERNS[k]), k);
    for (const k of ["cvt", "dct", "single", "automatic", "manual"]) assert.ok(TRANSMISSION_SQL.includes(PATTERNS[k]), k);
    for (const v of Object.values(PATTERNS)) assert.ok(!v.includes("\\"), "patterns must not need a backslash");
  });
  it("a class is never guessed: no match means NULL (no ELSE branch except gas, which needs an engine)", () => {
    assert.ok(!/ELSE/.test(DRIVETRAIN_SQL + TRANSMISSION_SQL + FUEL_SQL));
    assert.match(FUEL_SQL, /i\.engine IS NOT NULL AND i\.engine <> '' THEN 'gas' END\)$/);
  });
});

describe("list query: the new predicates", () => {
  const base = "make=Ford&inStock=1&retailOnly=1";
  it("a query without any of them is unchanged and reports nothing applied", () => {
    const r = q(base);
    assert.deepEqual(r.filtersApplied, []);
    assert.ok(!/body_style|REGEXP|vin LIKE|vin_rev|i\.mileage >=/.test(r.countSql));
    assert.ok(q("make=Ford&dealerId=7&inStock=1").args.includes(7));
    assert.match(q("make=Ford&dealerId=7&inStock=1").countSql, /i\.dealer_id = \?/);
  });
  it("mileage minimum, body style and several dealers", () => {
    const r = q(`${base}&odometerMin=5000&odometerMax=60000&bodyStyle=SUV&bodyStyle=Pickup&dealerId=12&dealerId=34`);
    assert.match(r.countSql, /i\.mileage >= \?/);
    assert.match(r.countSql, /i\.body_style IN \(\?,\?\)/);
    assert.match(r.countSql, /i\.dealer_id IN \(\?,\?\)/);
    assert.deepEqual(r.filtersApplied.sort(), ["bodyStyle", "dealerId", "odometerMin"]);
    for (const v of [5000, 60000, "SUV", "Pickup", 12, 34]) assert.ok(r.args.includes(v), String(v));
  });
  it("fuel, drivetrain and transmission need a make, and unknown values are dropped", () => {
    const r = q(`${base}&fuel=hybrid&fuel=rocket&drivetrain=awd&transmission=cvt&transmission=cvt`);
    assert.match(r.countSql, /CASE WHEN CONCAT_WS\(' ', i\.trim, i\.engine, i\.model\)/);
    assert.deepEqual(r.filtersApplied.sort(), ["drivetrain", "fuel", "transmission"]);
    assert.equal(r.args.filter((a) => a === "hybrid").length, 1);
    assert.ok(!r.args.includes("rocket"));
    const none = q("state=NJ&inStock=1&fuel=gas&drivetrain=awd");
    assert.deepEqual(none.filtersApplied, []);
    assert.ok(!/REGEXP/.test(none.countSql));
    assert.deepEqual(q(`${base}&fuel=rocket`).filtersApplied, []);
  });
  it("a VIN pattern: prefix on vin, suffix on vin_rev, anything else only with a make; wildcards become LIKE wildcards", () => {
    assert.match(q("inStock=1&vinPattern=1ft*").countSql, /i\.vin LIKE \?/);
    assert.ok(q("inStock=1&vinPattern=1ft*").args.includes("1FT%"));
    assert.match(q("inStock=1&vinPattern=*123456").countSql, /i\.vin_rev LIKE \?/);
    assert.ok(q("inStock=1&vinPattern=*123456").args.includes("654321%"));
    assert.deepEqual(q("inStock=1&vinPattern=1?3?5?7").filtersApplied, []);
    assert.deepEqual(q(`${base}&vinPattern=1?3?5?7`).filtersApplied, ["vinPattern"]);
    assert.ok(q(`${base}&vinPattern=1?3?5?7`).args.includes("1_3_5_7"));
    assert.deepEqual(q(`${base}&vinPattern=1f`).filtersApplied, []);
    assert.equal(cleanVinPattern("a'b;--*%"), "AB*");
  });
  it("junk never reaches the SQL text", () => {
    const r = q(`${base}&bodyStyle=SUV';DROP TABLE x;--&dealerId=1;DROP&odometerMin=abc&vinPattern=%27OR1`);
    assert.ok(!/DROP|OR1/.test(r.countSql));
    assert.ok(!r.filtersApplied.includes("odometerMin"));
  });
  it("the cleaners", () => {
    assert.deepEqual(bodyStylesOf(new URLSearchParams("bodyStyle=SUV&bodyStyle=suv&bodyStyle=%20Crew%20Cab%20")), ["SUV", "Crew Cab"]);
    assert.deepEqual(dealerIdsOf(new URLSearchParams("dealerId=0&dealerId=12&dealerId=12&dealerId=x")), [12]);
    assert.deepEqual(cleanFuel(["gas", "gas", "x"]), ["gas"]);
  });
});

describe("facet counts", () => {
  const car = (o) => ({ year: 2025, mileage: 12000, body: "SUV", days: 10, dealer_id: 1, dealer_name: "A", fuel: "gas", drive: "awd", trans: "automatic", ...o });
  const none = { yearMin: null, yearMax: null, odoMin: null, odoMax: null, daysMin: null, daysMax: null, body: [], fuel: [], drive: [], trans: [], dealers: [] };
  it("counts each list over the cars that pass every OTHER filter, never its own", () => {
    const rows = [car({}), car({ fuel: "hybrid" }), car({ fuel: "hybrid", drive: "fwd" }), car({ fuel: "electric", drive: "rwd" })];
    const d = foldFacetCounts(rows, { ...none, fuel: ["hybrid"], drive: ["awd"] });
    // fuel list: cars passing drivetrain=awd (the other filter): gas 1 + hybrid 1; the fwd hybrid fails drivetrain, the rwd electric too
    assert.deepEqual(d.fuel, [{ v: "gas", n: 1 }, { v: "hybrid", n: 1 }]);
    // drivetrain list: cars passing fuel=hybrid: awd 1, fwd 1
    assert.deepEqual(d.drivetrain, [{ v: "awd", n: 1 }, { v: "fwd", n: 1 }]);
    // every other list: cars passing BOTH (only the awd hybrid)
    assert.deepEqual(d.transmission, [{ v: "automatic", n: 1 }]);
    assert.deepEqual(d.year, [{ v: 2025, n: 1 }]);
  });
  it("a car failing two filters counts nowhere; null never passes a set bound", () => {
    const rows = [car({ year: null }), car({ mileage: null }), car({ fuel: null })];
    const d = foldFacetCounts(rows, { ...none, yearMin: 2020, odoMax: 50000 });
    assert.deepEqual(d.year, [{ v: 2025, n: 1 }]); // the year list ignores yearMin: the null-year car has no year to count, the null-mileage car fails the mileage filter
    assert.equal(d.mileage.noMileage, 1); // the mileage list ignores odometerMax: the null-mileage car counts here (it passes everything else)
    assert.equal(d.mileage.hist.reduce((a, b) => a + b, 0), 1); // the null-year car fails yearMin, so only the complete car is in the histogram
  });
  it("mileage histogram, days bands, body styles and dealers", () => {
    const rows = [car({ mileage: 0 }), car({ mileage: 25000 }), car({ mileage: 999999 }), car({ days: 3 }), car({ days: 45 }), car({ days: 200 }), car({ body: "Pickup", dealer_id: 2, dealer_name: "B" })];
    const d = foldFacetCounts(rows, none);
    assert.equal(d.mileage.hist.length, MILEAGE_BUCKETS);
    assert.deepEqual([d.mileage.hist[0], d.mileage.hist[1], d.mileage.hist[2], d.mileage.hist[MILEAGE_BUCKETS - 1]], [1, 4, 1, 1]);
    assert.deepEqual(d.days, [{ v: "0-7", n: 1 }, { v: "8-30", n: 4 }, { v: "31-60", n: 1 }, { v: "91+", n: 1 }]);
    assert.deepEqual(d.bodyStyle, [{ v: "SUV", n: 6 }, { v: "Pickup", n: 1 }]);
    assert.deepEqual(d.dealer, [{ id: "1", name: "A", n: 6 }, { id: "2", name: "B", n: 1 }]);
  });
  it("bandOfDays and the band table", () => {
    assert.deepEqual([0, 7, 8, 30, 31, 60, 61, 90, 91, 400].map(bandOfDays), ["0-7", "0-7", "8-30", "8-30", "31-60", "31-60", "61-90", "61-90", "91+", "91+"]);
    assert.deepEqual(DAYS_BANDS.map((b) => b[0]), ["0-7", "8-30", "31-60", "61-90", "91+"]);
  });
  it("too many rows answers tooBroad, never a partial count", () => {
    assert.deepEqual(buildFacetCountsResponse(new Array(1001).fill(car({})), 1000, none), { supported: true, tooBroad: true, cap: 1000 });
    const ok = buildFacetCountsResponse(new Array(1000).fill(car({})), 1000, none);
    assert.equal(ok.rows, 1000);
    assert.equal(ok.dims.fuel[0].n, 1000);
  });
  it("the row query: the list's own FROM/WHERE, small columns, one row past the cap; faceted params never reach the list query", () => {
    const params = new URLSearchParams("make=Ford&model=F-150&inStock=1&retailOnly=1&fuel=gas&yearMin=2020&dealerId=3&minDays=8&odometerMax=9&bodyStyle=SUV&limit=24&sort=price:asc&countCap=1000&priceMax=50000");
    const stripped = paramsWithoutFaceted(params);
    for (const k of ["fuel", "yearMin", "dealerId", "minDays", "odometerMax", "bodyStyle", "limit", "sort", "countCap"]) assert.ok(!stripped.has(k), k);
    assert.equal(stripped.get("priceMax"), "50000");
    const { countSql, args } = inventoryListQuery(stripped);
    assert.ok(!/i\.year >=|i\.dealer_id|body_style IN|body_style = /.test(countSql));
    const sql = facetRowsSql(countSql, 40000);
    assert.match(sql, /^SELECT i\.year AS year, i\.mileage AS mileage, i\.body_style AS body/);
    assert.match(sql, /LIMIT 40001$/);
    assert.ok(!/SELECT i\.\*/.test(sql));
    assert.ok(args.includes("Ford") && args.includes(50000));
    assert.deepEqual(facetedFiltersOf(params), { yearMin: 2020, yearMax: null, odoMin: null, odoMax: 9, daysMin: 8, daysMax: null, body: ["suv"], fuel: ["gas"], drive: [], trans: [], dealers: ["3"] });
  });
  it("row cap and cache", () => {
    assert.equal(rowCapOf({}), 40000);
    assert.equal(rowCapOf({ FACET_COUNTS_ROW_CAP: "5000" }), 5000);
    assert.equal(rowCapOf({ FACET_COUNTS_ROW_CAP: "5" }), 40000);
    assert.equal(rowCapOf({ FACET_COUNTS_ROW_CAP: "99999999" }), 100000);
    let t = 0;
    const c = createTtlCache({ ttlMs: 100, max: 2, now: () => t });
    c.set("a", 1); c.set("b", 2); c.set("c", 3);
    assert.equal(c.get("a"), undefined); assert.equal(c.get("c"), 3);
    t = 101; assert.equal(c.get("c"), undefined);
  });
});

describe("server wiring", () => {
  const server = fs.readFileSync(path.join(here, "../src/deals_api_server.js"), "utf8");
  it("registers the route, gates it, caches it, and echoes filtersApplied on the list", () => {
    assert.match(server, /pathname === "\/api\/inventory\/facet-counts"\) return run\(handleFacetCounts, url\.searchParams\)/);
    assert.match(server, /const facetCountsGate = createGate\(/);
    assert.match(server, /facetCountsGate\.run\(/);
    assert.match(server, /body\.filtersApplied = filtersApplied;/);
    assert.match(server, /if \(!\(params\.get\("make"\) \|\| ""\)\.trim\(\)\) return badRequest/);
  });
});
