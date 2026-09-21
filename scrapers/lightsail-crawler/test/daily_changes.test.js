import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { buildBrandChangeRecord, mergeDailyChangesDocument } from '../src/daily_changes.js';

// ---------------------------------------------------------------------
// Bug 3: daily_changes_<date>.json used to be overwritten wholesale by
// every brand's run, so a multi-brand day (many standalone.js invocations,
// one per brand, same calendar date) only ever left the LAST brand's
// record behind. Confirmed live against the real, committed
// data/daily_changes/daily_changes_2026-09-14.json (written before this
// fix): a single Toyota-only record with totalNewArrivals equal to
// totalActiveInventory and a totalSoldOrRemoved bigger than the active
// count — the cross-brand mislabeling bug inventory_merge.js's header
// comment describes, compounded by this file discarding every earlier
// brand's real record for that date.
// ---------------------------------------------------------------------
describe('daily_changes (bug 3: multi-brand, multi-state daily record)', () => {
  const todayDate = '2026-09-14';
  const todayIso = '2026-09-14T12:00:00.000Z';

  it('buildBrandChangeRecord records date + old/new price + delta for every changed vehicle, not just a top-50 sample', () => {
    const priceDrops = [];
    for (let i = 1; i <= 60; i++) {
      priceDrops.push({
        vin: `DROP${i}`,
        dealerName: 'Toyota of Somewhere',
        price: 30000 - i,
        oldPrice: 30000,
        priceDiff: -i,
      });
    }
    const priceIncreases = [
      { vin: 'INC1', dealerName: 'Toyota of Somewhere', price: 31000, oldPrice: 30500, priceDiff: 500 },
    ];

    const record = buildBrandChangeRecord({
      brand: 'Toyota',
      state: 'NJ',
      todayDate,
      todayIso,
      totalDealersConfigured: 5,
      activeDealersCount: 5,
      currentInventorySize: 500,
      newArrivals: [{ vin: 'NEW1' }],
      priceDrops,
      priceIncreases,
      soldVehicles: [{ vin: 'SOLD1' }],
      dealerStats: { 'Toyota of Somewhere': 500 },
      skippedForBotProtection: 0,
    });

    // Every one of the 60 drops + 1 increase is present with date + delta —
    // not capped at 50 like the old topPriceDrops-only behavior.
    assert.equal(record.priceChanges.length, 61);
    const drop0 = record.priceChanges.find((c) => c.vin === 'DROP1');
    assert.equal(drop0.date, todayDate);
    assert.equal(drop0.oldPrice, 30000);
    assert.equal(drop0.newPrice, 29999);
    assert.equal(drop0.priceDiff, -1);
    assert.equal(drop0.changeType, 'PRICE_DROP');

    const inc = record.priceChanges.find((c) => c.vin === 'INC1');
    assert.equal(inc.changeType, 'PRICE_INCREASE');
    assert.equal(inc.oldPrice, 30500);
    assert.equal(inc.newPrice, 31000);
    assert.equal(inc.priceDiff, 500);

    // topPriceDrops stays a bounded, sorted convenience view.
    assert.equal(record.topPriceDrops.length, 50);
    assert.equal(record.stats.totalPriceDrops, 60);
    assert.equal(record.stats.totalPriceIncreases, 1);
  });

  it('keeps two brands run the same day as separate slots instead of the second overwriting the first', () => {
    const toyotaRecord = buildBrandChangeRecord({
      brand: 'Toyota',
      state: 'NJ',
      todayDate,
      todayIso,
      totalDealersConfigured: 10,
      activeDealersCount: 8,
      currentInventorySize: 900,
      newArrivals: [],
      priceDrops: [],
      priceIncreases: [],
      soldVehicles: [],
      dealerStats: {},
      skippedForBotProtection: 2,
    });
    let doc = mergeDailyChangesDocument({ existing: null, state: 'NJ', brand: 'Toyota', brandRecord: toyotaRecord, todayDate, todayIso });

    const hondaRecord = buildBrandChangeRecord({
      brand: 'Honda',
      state: 'NJ',
      todayDate,
      todayIso,
      totalDealersConfigured: 6,
      activeDealersCount: 5,
      currentInventorySize: 400,
      newArrivals: [],
      priceDrops: [],
      priceIncreases: [],
      soldVehicles: [],
      dealerStats: {},
      skippedForBotProtection: 1,
    });
    doc = mergeDailyChangesDocument({ existing: doc, state: 'NJ', brand: 'Honda', brandRecord: hondaRecord, todayDate, todayIso });

    // Both brands present — this is exactly what the pre-fix overwrite lost.
    assert.ok(doc.states.NJ.brands.Toyota);
    assert.ok(doc.states.NJ.brands.Honda);
    assert.equal(doc.states.NJ.brands.Toyota.stats.totalActiveInventory, 900);
    assert.equal(doc.states.NJ.brands.Honda.stats.totalActiveInventory, 400);

    // State- and file-level totals are the sum of every brand slot present,
    // not just the most recently written one.
    assert.equal(doc.states.NJ.stats.totalActiveInventory, 1300);
    assert.equal(doc.stats.totalActiveInventory, 1300);
    assert.equal(doc.brandsRun, 2);
  });

  it('keeps the same brand in two different states as separate slots (NJ Toyota vs NY Toyota)', () => {
    const njToyota = buildBrandChangeRecord({
      brand: 'Toyota',
      state: 'NJ',
      todayDate,
      todayIso,
      totalDealersConfigured: 10,
      activeDealersCount: 8,
      currentInventorySize: 900,
      newArrivals: [],
      priceDrops: [],
      priceIncreases: [],
      soldVehicles: [],
      dealerStats: {},
      skippedForBotProtection: 0,
    });
    let doc = mergeDailyChangesDocument({ existing: null, state: 'NJ', brand: 'Toyota', brandRecord: njToyota, todayDate, todayIso });

    const nyToyota = buildBrandChangeRecord({
      brand: 'Toyota',
      state: 'NY',
      todayDate,
      todayIso,
      totalDealersConfigured: 12,
      activeDealersCount: 10,
      currentInventorySize: 1500,
      newArrivals: [],
      priceDrops: [],
      priceIncreases: [],
      soldVehicles: [],
      dealerStats: {},
      skippedForBotProtection: 0,
    });
    doc = mergeDailyChangesDocument({ existing: doc, state: 'NY', brand: 'Toyota', brandRecord: nyToyota, todayDate, todayIso });

    assert.equal(doc.states.NJ.brands.Toyota.stats.totalActiveInventory, 900);
    assert.equal(doc.states.NY.brands.Toyota.stats.totalActiveInventory, 1500);
    assert.equal(doc.stats.totalActiveInventory, 2400);
  });

  it('replaces (not duplicates) a brand slot when that brand is rerun the same day', () => {
    const first = buildBrandChangeRecord({
      brand: 'Kia',
      state: 'NJ',
      todayDate,
      todayIso,
      totalDealersConfigured: 4,
      activeDealersCount: 4,
      currentInventorySize: 100,
      newArrivals: [],
      priceDrops: [],
      priceIncreases: [],
      soldVehicles: [],
      dealerStats: {},
      skippedForBotProtection: 0,
    });
    let doc = mergeDailyChangesDocument({ existing: null, state: 'NJ', brand: 'Kia', brandRecord: first, todayDate, todayIso });

    const rerun = buildBrandChangeRecord({
      brand: 'Kia',
      state: 'NJ',
      todayDate,
      todayIso,
      totalDealersConfigured: 4,
      activeDealersCount: 4,
      currentInventorySize: 105,
      newArrivals: [],
      priceDrops: [],
      priceIncreases: [],
      soldVehicles: [],
      dealerStats: {},
      skippedForBotProtection: 0,
    });
    doc = mergeDailyChangesDocument({ existing: doc, state: 'NJ', brand: 'Kia', brandRecord: rerun, todayDate, todayIso });

    assert.equal(doc.brandsRun, 1);
    assert.equal(doc.states.NJ.brands.Kia.stats.totalActiveInventory, 105);
  });

  it('starts a fresh document instead of merging into a stale prior day', () => {
    const staleDoc = { date: '2026-09-13', states: { NJ: { brands: { Toyota: {} }, stats: {} } }, stats: {} };
    const record = buildBrandChangeRecord({
      brand: 'Toyota',
      state: 'NJ',
      todayDate,
      todayIso,
      totalDealersConfigured: 1,
      activeDealersCount: 1,
      currentInventorySize: 10,
      newArrivals: [],
      priceDrops: [],
      priceIncreases: [],
      soldVehicles: [],
      dealerStats: {},
      skippedForBotProtection: 0,
    });
    const doc = mergeDailyChangesDocument({ existing: staleDoc, state: 'NJ', brand: 'Toyota', brandRecord: record, todayDate, todayIso });
    assert.equal(doc.date, todayDate);
    assert.equal(doc.brandsRun, 1);
  });
});
