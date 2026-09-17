import assert from "node:assert/strict";
import { describe, it } from "node:test";
import fs from "node:fs";
import { bandShares, bandsOf, daysSupply, discountPct, domBand, isInScopeMake, mean, median, mixVsBrandNorm, pct, turnRate, vehicleDom } from "./dealerAnalytics";

const NOW = new Date("2026-09-17T12:00:00Z");

describe("DOM (days on market) — the same formula the box runs in SQL", () => {
  it("prefers the crawl's days_on_lot; else first seen (crawl_first_seen, then first_seen_at) → removed / today", () => {
    assert.equal(vehicleDom({ daysOnLot: 12, firstSeenAt: "2026-01-01T00:00:00Z" }, NOW), 12);
    assert.equal(vehicleDom({ daysOnLot: 0, crawlFirstSeen: "2026-09-01", firstSeenAt: "2026-09-10T00:00:00Z" }, NOW), 16, "days_on_lot 0 counts as unknown; crawl_first_seen wins over first_seen_at");
    assert.equal(vehicleDom({ firstSeenAt: "2026-09-10T15:00:00Z" }, NOW), 7);
    assert.equal(vehicleDom({ firstSeenAt: "2026-08-01T00:00:00Z", removedAt: "2026-08-31T00:00:00Z" }, NOW), 30, "a removed car stops aging on the day it left");
  });
  it("bands: 0–14 / 15–45 / 46–90 / 90+", () => {
    assert.deepEqual([0, 14, 15, 45, 46, 90, 91].map(domBand), ["d0_14", "d0_14", "d15_45", "d15_45", "d46_90", "d46_90", "d90p"]);
    assert.deepEqual(bandsOf([1, 20, 60, 120, 14]), { d0_14: 2, d15_45: 1, d46_90: 1, d90p: 1 });
    assert.deepEqual(bandShares({ d0_14: 2, d15_45: 1, d46_90: 1, d90p: 0 }), { d0_14: 50, d15_45: 25, d46_90: 25, d90p: 0 });
  });
  it("mean and median", () => {
    assert.equal(mean([10, 20, 60]), 30);
    assert.equal(median([10, 20, 60]), 20);
    assert.equal(median([10, 20, 60, 100]), 40, "even count → midpoint");
    assert.equal(median([]), null);
  });
});

describe("velocity and pricing", () => {
  it("turn rate = removed in 7 days ÷ on lot; days supply = on lot ÷ weekly pace", () => {
    assert.equal(turnRate(200, 10), 5);
    assert.equal(turnRate(0, 10), null);
    assert.equal(daysSupply(200, 10, 40), 140, "pace from 28 days: 40/4 = 10 a week → 200 ÷ (10/7)");
    assert.equal(daysSupply(200, 5, 0), 280, "no 28-day churn recorded yet → last 7 days");
    assert.equal(daysSupply(200, 0, 0), null);
  });
  it("discount % = (MSRP − price) ÷ MSRP, only with both known", () => {
    assert.equal(discountPct(50000, 47500), 5);
    assert.equal(discountPct(50000, 51000), -2, "over sticker shows as negative");
    assert.equal(discountPct(null, 47500), null);
    assert.equal(discountPct(50000, 0), null);
    assert.equal(pct(3, 12), 25);
  });
  it("model mix vs brand norm, in share points", () => {
    const scope = [{ make: "Toyota", model: "RAV4", n: 30 }, { make: "Toyota", model: "Camry", n: 10 }];
    const norm = [{ make: "Toyota", model: "RAV4", n: 500 }, { make: "Toyota", model: "Camry", n: 300 }, { make: "Toyota", model: "Tacoma", n: 200 }];
    const mix = mixVsBrandNorm(scope, norm);
    assert.deepEqual(mix[0], { make: "Toyota", model: "RAV4", n: 30, scopeShare: 75, normShare: 50, delta: 25 });
    assert.equal(mix[1].delta, -5);
  });
  it("in-scope brands are the ones without public window stickers", () => {
    for (const m of ["Toyota", "Lexus", "Kia", "Honda", "Acura", "Nissan", "Infiniti", "Subaru", "Mazda", "Volkswagen", "VW", "Audi", "BMW", "Mercedes-Benz", "Mercedes", "Volvo", "Porsche", "MINI", "Mitsubishi"]) assert.equal(isInScopeMake(m), true, m);
    for (const m of ["Ford", "Chevrolet", "GMC", "Buick", "Cadillac", "Jeep", "Ram", "Dodge", "Chrysler", "Hyundai", "Genesis", "Tesla", "Rivian", "Lucid", ""]) assert.equal(isInScopeMake(m), false, m || "(blank)");
  });
});

describe("wiring", () => {
  it("the box endpoint uses the same DOM formula and bands; the page mounts on Site Analytics; the doc exists", () => {
    const box = fs.readFileSync("scrapers/lightsail-crawler/src/deals_api_server.js", "utf8");
    assert.match(box, /COALESCE\(NULLIF\(i\.days_on_lot, 0\), DATEDIFF\(COALESCE\(i\.removed_at, NOW\(\)\), COALESCE\(i\.crawl_first_seen, i\.first_seen_at\)\)\)/);
    assert.match(box, /<= 14\) AS d0_14, SUM\(.*BETWEEN 15 AND 45\) AS d15_45, SUM\(.*BETWEEN 46 AND 90\) AS d46_90, SUM\(.*> 90\) AS d90p/);
    assert.match(box, /pathname === "\/api\/inventory\/analytics"/);
    // Median subqueries must reference the derived table's plain aliases, never i.<col> or an AS in GROUP BY.
    assert.match(box, /async function medians\(partition, innerCols, outerCols\)/);
    assert.match(box, /SELECT \$\{outerCols\}, MAX\(med\) AS med FROM \(SELECT \$\{innerCols\}, MEDIAN/);
    assert.match(box, /medians\("i\.make, i\.model", "i\.make AS make, i\.model AS model", "make, model"\)/);
    assert.doesNotMatch(box, /GROUP BY \$\{keyCols\}/, "the broken alias-in-GROUP-BY median query is gone");
    assert.match(fs.readFileSync("scripts/box/2026-09-17-inventory-analytics.sh", "utf8"), /analytics handler/);
    const page = fs.readFileSync("app/admin/analytics/AnalyticsClient.tsx", "utf8");
    assert.match(page, /<DealerAnalyticsSection \/>/);
    assert.match(page, /Site Analytics/, "the existing page is extended, not duplicated");
    const section = fs.readFileSync("app/admin/analytics/DealerAnalyticsSection.tsx", "utf8");
    for (const id of ["filter-state", "filter-make", "filter-dealer", "filter-model", "filter-from", "filter-to", "dealer-leaderboard", "model-leaderboard", "band-chart", "price-cuts", "coverage", "analytics-empty", "analytics-error"]) assert.match(section, new RegExp(`data-testid="${id}"`), id);
    assert.doesNotMatch(section, /HTML DOM|bypass|WAF/i, "DOM means days on market; public-data-only copy");
    assert.match(fs.readFileSync("docs/DEALER_ANALYTICS.md", "utf8"), /days on market/i);
  });
});
