// Builds and merges one brand-run's day-over-day change record into the
// shared data/daily_changes/daily_changes_<date>.json file.
//
// Root cause this fixes: standalone.js used to *overwrite* the whole
// per-date file on every run via a single flat `dailySummary` object. One
// invocation of standalone.js only ever covers a single brand, so a
// state's daily loop (many brands, one process per brand, same calendar
// date) clobbered every earlier brand's changes that same day — only the
// LAST brand run of the day left any trace in daily_changes_<date>.json.
// Confirmed live: data/daily_changes/daily_changes_2026-09-14.json, as
// committed at c207742 (before today's cross-brand merge fix in
// inventory_merge.js and before this file existed), holds exactly one
// brand's (NY Toyota's) numbers for the whole day — totalNewArrivals equal
// to totalActiveInventory and a totalSoldOrRemoved larger than the active
// count, which is the same "every other brand's inventory mislabeled" bug
// inventory_merge.js's header comment describes, compounded by this file
// having thrown away every earlier brand's real record for that date.
//
// Fix: key the file by state -> brand, so every brand's run that day gets
// its own slot; read-modify-write (merge) instead of overwrite; and record
// a complete `priceChanges` list — date, old/new price, delta — for every
// single vehicle that changed price this run, not just a top-50 sample.
// Aggregated `stats` (both per-state and file-level) are recomputed fresh
// from whatever brand slots are present, so they can never drift from the
// per-brand detail and stay correct no matter what order brands ran in or
// whether a brand is rerun later the same day (its slot is simply replaced).
//
// Concurrency note: this assumes brand runs are serial, never concurrent —
// the same assumption standalone.js's own README already documents
// ("Never run two brands concurrently"). A read-modify-write here is not
// safe against two processes writing the same date's file at once.

export function buildBrandChangeRecord({
  brand,
  state,
  todayDate,
  todayIso,
  totalDealersConfigured,
  activeDealersCount,
  currentInventorySize,
  newArrivals = [],
  priceDrops = [],
  priceIncreases = [],
  soldVehicles = [],
  dealerStats = {},
  skippedForBotProtection = 0,
}) {
  const priceChanges = [
    ...priceDrops.map((v) => ({
      vin: v.vin,
      dealerName: v.dealerName || v.configDealerName || null,
      brand,
      state,
      date: todayDate,
      changeType: 'PRICE_DROP',
      oldPrice: v.oldPrice ?? null,
      newPrice: v.price ?? null,
      priceDiff: v.priceDiff ?? null,
    })),
    ...priceIncreases.map((v) => ({
      vin: v.vin,
      dealerName: v.dealerName || v.configDealerName || null,
      brand,
      state,
      date: todayDate,
      changeType: 'PRICE_INCREASE',
      oldPrice: v.oldPrice ?? null,
      newPrice: v.price ?? null,
      priceDiff: v.priceDiff ?? null,
    })),
  ];

  return {
    brand,
    state,
    date: todayDate,
    timestamp: todayIso,
    totalDealersConfigured,
    activeDealersCount,
    stats: {
      totalActiveInventory: currentInventorySize,
      totalNewArrivals: newArrivals.length,
      totalPriceDrops: priceDrops.length,
      totalPriceIncreases: priceIncreases.length,
      totalSoldOrRemoved: soldVehicles.length,
      skippedForBotProtection,
    },
    // Every vehicle that changed price today, in full — this is the record
    // the "daily changes with date + price change" requirement needs.
    priceChanges,
    // Kept for quick-glance reporting (biggest drops first); priceChanges
    // above is the complete, authoritative list.
    topPriceDrops: [...priceDrops]
      .sort((a, b) => (a.priceDiff ?? 0) - (b.priceDiff ?? 0))
      .slice(0, 50),
    dealerBreakdown: dealerStats,
  };
}

function sumStats(brandRecords) {
  const stats = {
    totalActiveInventory: 0,
    totalNewArrivals: 0,
    totalPriceDrops: 0,
    totalPriceIncreases: 0,
    totalSoldOrRemoved: 0,
    skippedForBotProtection: 0,
  };
  for (const rec of brandRecords) {
    for (const key of Object.keys(stats)) {
      stats[key] += rec.stats?.[key] || 0;
    }
  }
  return stats;
}

// Merges one brand's freshly-built record into the existing day's document
// (or starts a fresh one), keyed by state -> brand so brands never collide
// and, within a state/brand, a rerun the same day simply replaces that
// slot rather than duplicating it.
export function mergeDailyChangesDocument({ existing, state, brand, brandRecord, todayDate, todayIso }) {
  const doc = existing && existing.date === todayDate
    ? { ...existing, states: { ...existing.states } }
    : { date: todayDate, states: {} };

  doc.generatedAt = todayIso;

  const prevStateEntry = doc.states[state] || { brands: {} };
  const stateEntry = { brands: { ...prevStateEntry.brands } };
  stateEntry.brands[brand] = brandRecord;
  stateEntry.stats = sumStats(Object.values(stateEntry.brands));
  doc.states[state] = stateEntry;

  // File-level aggregate across every state/brand recorded so far today.
  const allBrandRecords = Object.values(doc.states).flatMap((s) => Object.values(s.brands));
  doc.stats = sumStats(allBrandRecords);
  doc.brandsRun = allBrandRecords.length;

  return doc;
}
