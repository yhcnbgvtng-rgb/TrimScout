// Condition counts, price histogram and colour counts for the catalog facets (flag FACET_COND_PRICE), and the keyword-exclude predicate of the list query.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  facetExtrasEnabled, extraBudgetPct, priceBucketSql, extraAggSql, budgetAllows, createExtrasAccumulator, foldExtras, colorCountsFrom,
  PRICE_BUCKETS, PRICE_BUCKET_WIDTH, NO_PRICE_BUCKET, MAX_EXTRA_BUDGET_PCT,
} from '../src/facetExtras.js';
import { inventoryListQuery, excludeTermsOf } from '../src/inventoryListQuery.js';

const server = fs.readFileSync(new URL('../src/deals_api_server.js', import.meta.url), 'utf8');

describe('flag and budget settings', () => {
  it('is off unless explicitly turned on', () => {
    assert.equal(facetExtrasEnabled({}), false);
    for (const v of ['', '0', 'off', 'false']) assert.equal(facetExtrasEnabled({ FACET_COND_PRICE: v }), false, v);
    for (const v of ['1', 'true', 'ON', ' yes ']) assert.equal(facetExtrasEnabled({ FACET_COND_PRICE: v }), true, v);
  });
  it('the budget defaults to 10 and can never be raised above it', () => {
    assert.equal(extraBudgetPct({}), 10);
    assert.equal(extraBudgetPct({ FACET_EXTRA_BUDGET_PCT: '50' }), MAX_EXTRA_BUDGET_PCT);
    assert.equal(extraBudgetPct({ FACET_EXTRA_BUDGET_PCT: '4' }), 4);
    assert.equal(extraBudgetPct({ FACET_EXTRA_BUDGET_PCT: '0' }), 10);
    assert.equal(extraBudgetPct({ FACET_EXTRA_BUDGET_PCT: 'x' }), 10);
  });
});

describe('extra aggregate SQL', () => {
  it('walks the same index and filters as the colour aggregate, one placeholder (the make)', () => {
    const sql = extraAggSql({ retailOnly: true, staleDays: 7 });
    assert.match(sql, /FROM dealer_inventory FORCE INDEX \(idx_inv_stock_make_model_trim\)/);
    assert.match(sql, /WHERE removed_at IS NULL AND make = \?/);
    assert.match(sql, /\(cond IS NULL OR cond <> 'wholesale'\)/);
    assert.match(sql, /last_seen_at >= DATE_SUB\(NOW\(\), INTERVAL 7 DAY\)/);
    assert.equal((sql.match(/\?/g) || []).length, 1);
    assert.doesNotMatch(extraAggSql({}), /wholesale|DATE_SUB/);
  });
  it('buckets by $5,000 with an open top bucket and a marker for no price', () => {
    assert.equal(PRICE_BUCKETS, 31);
    assert.equal(priceBucketSql('price'), `IF(price > 0, LEAST(FLOOR(price / ${PRICE_BUCKET_WIDTH}), 30), ${NO_PRICE_BUCKET})`);
  });
});

describe('rebuild budget: the extra time stays within 10% of the rest of the build', () => {
  // Simulates the rebuild loop: every make costs `base` ms plus, when allowed, `extra` ms.
  function simulate({ makes, base, extra, pct = 10 }) {
    let elapsed = 0, extraMs = 0, skipped = 0;
    for (let i = 0; i < makes; i++) {
      if (budgetAllows({ makesDone: i, elapsedMs: elapsed, extraMs, budgetPct: pct })) { elapsed += extra; extraMs += extra; } else skipped++;
      elapsed += base;
    }
    return { overheadPct: (100 * extraMs) / (elapsed - extraMs), skipped, extraMs };
  }
  it('runs every make when the extra query is cheap', () => {
    const r = simulate({ makes: 60, base: 1000, extra: 50 });
    assert.equal(r.skipped, 0);
    assert.ok(r.overheadPct <= 10);
  });
  it('skips makes (and lands within the budget, plus at most one make of slack) when the extra query is expensive', () => {
    for (const extra of [150, 400, 1000, 5000]) {
      const r = simulate({ makes: 60, base: 1000, extra });
      assert.ok(r.skipped > 0, `extra=${extra} should skip some`);
      assert.ok(r.overheadPct <= 10 + (100 * extra) / (1000 * 60) + 0.01, `extra=${extra}: overhead ${r.overheadPct.toFixed(2)}%`);
    }
  });
  it('a lower configured budget is honoured', () => {
    const r = simulate({ makes: 60, base: 1000, extra: 80, pct: 4 });
    assert.ok(r.skipped > 0);
    assert.ok(r.overheadPct <= 4 + 0.5);
  });
  it('the warm-up makes always run', () => {
    assert.equal(budgetAllows({ makesDone: 0, elapsedMs: 0, extraMs: 0 }), true);
    assert.equal(budgetAllows({ makesDone: 1, elapsedMs: 100, extraMs: 90 }), false); // after the first make the projection decides
    assert.equal(budgetAllows({ makesDone: 1, elapsedMs: 1000, extraMs: 50 }), true);
  });
});

describe('folding aggregate rows into the catalog payload', () => {
  const rows = [
    { cond: 'new', bucket: 6, n: 10 }, { cond: 'new', bucket: 7, n: 5 }, { cond: 'used', bucket: 2, n: 4 },
    { cond: 'cpo', bucket: 30, n: 1 }, { cond: '', bucket: 6, n: 2 }, { cond: 'new', bucket: NO_PRICE_BUCKET, n: 3 },
  ];
  it('counts conditions (priced or not) and builds one histogram per condition plus an all-conditions one', () => {
    const f = foldExtras(rows);
    assert.deepEqual(f.conditionCounts, { new: 18, used: 4, cpo: 1 });
    assert.equal(f.priceHistogram.width, 5000);
    assert.equal(f.priceHistogram.all.length, 31);
    assert.equal(f.priceHistogram.all[6], 12);   // new 10 + unknown-cond 2
    assert.equal(f.priceHistogram.new[6], 10);
    assert.equal(f.priceHistogram.new.reduce((a, b) => a + b, 0), 15); // the 3 unpriced cars are not in the histogram
    assert.equal(f.priceHistogram.cpo[30], 1);
  });
  it('says nothing when there are no rows', () => {
    assert.equal(foldExtras([]), null);
    assert.equal(foldExtras(null), null);
  });
  it('the accumulator sums makes into the all-makes summary rows', () => {
    const acc = createExtrasAccumulator();
    acc.add([{ cond: 'new', bucket: 6, n: 3 }]);
    acc.add([{ cond: 'new', bucket: 6, n: 4 }, { cond: 'used', bucket: 1, n: 2 }]);
    assert.deepEqual(acc.rows().sort((a, b) => a[0].localeCompare(b[0])), [['new', 6, 7], ['used', 1, 2]]);
  });
});

describe('colour counts', () => {
  it('sums per colour across trims, merges case-only spellings, drops blanks, sorts by count', () => {
    const c = colorCountsFrom([
      { exterior_color: 'Blue', interior_color: 'Black', n: 5 }, { exterior_color: 'blue', interior_color: 'Gray', n: 3 },
      { exterior_color: 'White', interior_color: '', n: 6 }, { exterior_color: '', interior_color: 'Black', n: 2 },
    ]);
    assert.deepEqual(c.exteriorColorCounts, [{ color: 'Blue', n: 8 }, { color: 'White', n: 6 }]);
    assert.deepEqual(c.interiorColorCounts, [{ color: 'Black', n: 7 }, { color: 'Gray', n: 3 }]);
  });
  it('gives nothing for rows without counts (the all-makes summary) or no rows', () => {
    assert.equal(colorCountsFrom([{ exterior_color: 'Blue', interior_color: null }]), null);
    assert.equal(colorCountsFrom([]), null);
  });
});

describe('keyword exclude in the list query', () => {
  const q = (...pairs) => inventoryListQuery(new URLSearchParams(pairs));
  it('adds one NOT (... LIKE ? OR ...) predicate with %word% args, after the other filters', () => {
    const r = q(['make', 'Toyota'], ['inStock', '1'], ['exclude', 'Black'], ['exclude', 'sport hybrid']);
    assert.deepEqual(r.excludeTerms, ['black', 'sport hybrid']);
    assert.match(r.countSql, /NOT \(CONCAT_WS\(' ', i\.year, i\.make, i\.model, i\.trim, i\.exterior_color, i\.interior_color\) LIKE \? OR CONCAT_WS/);
    assert.deepEqual(r.args.slice(-2), ['%black%', '%sport hybrid%']);
    assert.match(r.cappedCountSql || r.countSql, /idx_inv_stock_make_dealer|idx_inv_stock_make_model_trim/);
  });
  it('is index-bounded: the make index hint is unchanged by exclude', () => {
    const plain = q(['make', 'Toyota'], ['inStock', '1']);
    const withEx = q(['make', 'Toyota'], ['inStock', '1'], ['exclude', 'black']);
    assert.equal(plain.countSql.match(/FORCE INDEX \([a-z_]+\)/)[0], withEx.countSql.match(/FORCE INDEX \([a-z_]+\)/)[0]);
  });
  it('is ignored without a make (it would be a whole-table string scan)', () => {
    const r = q(['state', 'NJ'], ['inStock', '1'], ['exclude', 'black']);
    assert.deepEqual(r.excludeTerms, []);
    assert.doesNotMatch(r.countSql, /CONCAT_WS/);
  });
  it('sanitises words: wildcards and quotes removed, 2-24 characters, at most five, no repeats', () => {
    const p = new URLSearchParams([['exclude', '100%_x\\'], ['exclude', 'a'], ['exclude', 'x'.repeat(30)], ['exclude', "O'Neil"], ['exclude', 'BLACK'], ['exclude', 'black'], ['exclude', 'a1'], ['exclude', 'b2'], ['exclude', 'c3'], ['exclude', 'd4']]);
    const t = excludeTermsOf(p);
    assert.deepEqual(t, ['100 x', 'o neil', 'black', 'a1', 'b2']);
    for (const w of t) assert.doesNotMatch(w, /[%_\\']/);
  });
  it('no exclude param = the query is byte-for-byte what it was', () => {
    const r = q(['make', 'Toyota'], ['inStock', '1']);
    assert.deepEqual(r.excludeTerms, []);
    assert.doesNotMatch(r.sql + r.countSql, /CONCAT_WS|NOT \(/);
  });
});

describe('deals_api_server.js wiring: everything extra sits behind FACET_COND_PRICE', () => {
  it('reads the flag through facetExtrasEnabled() and never hard-codes it on', () => {
    assert.match(server, /const FACET_EXTRAS = facetExtrasEnabled\(\);/);
    assert.doesNotMatch(server, /FACET_COND_PRICE\s*[=:]\s*["']?(1|true|on)/i);
  });
  it('creates its tables and columns only when on', () => {
    assert.match(server, /if \(FACET_EXTRAS\) \{\n\s+await pool\.query\(`CREATE TABLE IF NOT EXISTS inv_price_facets/);
    assert.equal((server.match(/CREATE TABLE IF NOT EXISTS inv_price_facets/g) || []).length, 1);
    assert.equal((server.match(/CREATE TABLE IF NOT EXISTS inv_price_summary/g) || []).length, 1);
  });
  it('runs the extra aggregate only when on AND the budget allows, and times it', () => {
    const i = server.indexOf('if (budgetAllows({ makesDone');
    assert.ok(i > 0);
    const block = server.slice(i - 40, i + 520);
    assert.match(block, /if \(FACET_EXTRAS\) \{/);
    assert.match(block, /extraAggSql\(\{ retailOnly: RETAIL_ONLY_FACETS, staleDays: STALE_HIDE_DAYS \}\), \[make\]/);
    assert.match(block, /extraMs \+= Date\.now\(\) - t0;/);
    assert.equal((server.match(/extraAggSql\(/g) || []).length, 1);
  });
  it('counts the write into inv_price_facets against the budget, not just the SELECT', () => {
    assert.match(server, /const tw = Date\.now\(\);[\s\S]*INSERT INTO inv_price_facets[\s\S]*extraMs \+= Date\.now\(\) - tw;/);
  });
  it('rewrites the all-makes price summary only after a pass with no skipped make', () => {
    assert.match(server, /if \(FACET_EXTRAS && extraSkipped === 0\) \{\n\s+const priceRows = extrasAcc\.rows\(\);/);
  });
  it('the catalog read of the extras is guarded so it can never fail the call, and uses the same cache entry', () => {
    const fn = server.slice(server.indexOf('async function readCatalogExtras'), server.indexOf('async function handleInventoryCatalogOptions'));
    assert.match(fn, /try \{[\s\S]*\} catch \(err\) \{[\s\S]*return null;/);
    assert.match(server, /const extras = FACET_EXTRAS \? await readCatalogExtras\(pool, fWhereSql, fArgs, !make && !model && !trim\) : null;/);
    assert.match(server, /\.\.\.\(colorCountsFrom\(colorRows\) \|\| \{\}\),\n\s+\.\.\.\(extras \|\| \{\}\),/);
  });
  it('the colour read keeps the same row range (PK prefix) and just sums the stored counts', () => {
    assert.match(server, /SELECT exterior_color, interior_color, SUM\(vehicle_count\) AS n FROM inv_color_facets \$\{fWhereSql\} GROUP BY exterior_color, interior_color/);
    assert.doesNotMatch(server, /SELECT DISTINCT exterior_color, interior_color FROM inv_color_facets/);
  });
  it('the list handler echoes the applied exclude words', () => {
    assert.match(server, /if \(excludeTerms\.length\) body\.excludeApplied = excludeTerms;/);
  });
  it('the status call reports the extra time as a share of the rest of the build', () => {
    assert.match(server, /pctOfRestOfBuild:/);
    assert.match(server, /UPDATE inv_facet_meta SET extra_ms = \?, extra_skipped = \?/);
  });
});
