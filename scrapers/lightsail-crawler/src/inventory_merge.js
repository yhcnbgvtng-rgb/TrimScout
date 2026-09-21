// Merges one brand-run's freshly-crawled inventory into the shared,
// cumulative snapshot that spans every brand ever crawled into this data
// directory (national_inventory_latest.json / inventory_latest.json /
// snapshots/latest_snapshot.json).
//
// Root cause this fixes: the previous inline version of this logic (in
// standalone.js) scanned ALL of `previousSnapshot` — every brand's dealers,
// not just this run's — and marked any VIN not present in `currentInventory`
// as SOLD_OR_REMOVED unless its dealer was in this run's own
// `failedDealerNames`. Since `failedDealerNames` only ever contains dealers
// from the brand that just ran, every OTHER brand's still-active inventory
// got mislabeled SOLD_OR_REMOVED on every single run. Worse, the next run
// after that dropped those mislabeled records entirely, because the
// "carry an ACTIVE record forward" check requires `prev.status === 'ACTIVE'`
// — so after two more brand runs, an earlier brand's vehicles vanished from
// the shared files completely (confirmed live: after running 14 NJ brands
// back-to-back, data/inventory_latest.json and national_inventory_latest.json
// ended up containing only the last two brands run — Toyota ACTIVE and
// Subaru SOLD_OR_REMOVED — with the other 12 brands entirely gone, not just
// marked sold).
//
// The fix: only ever evaluate/mutate snapshot entries that belong to a
// dealer in *this run's own* `dealers` list. Any snapshot entry for a
// dealer outside that scope (i.e. a different brand's dealer) is carried
// forward completely untouched — this run has zero evidence about it either
// way, so it must never be relabeled ACTIVE, SOLD, or anything else by it.
export function mergeInventorySnapshot({
  previousSnapshot = {},
  currentInventory,
  dealers = [],
  failedDealerNames = new Set(),
  todayDate,
  todayIso,
  toPriceChangeType,
}) {
  const scopeDealerNames = new Set(dealers.map((d) => d.name));
  const updatedSnapshot = {};
  const priceDrops = [];
  const priceIncreases = [];
  const newArrivals = [];
  const soldVehicles = [];
  const allRecords = [];

  const changeTypeOf = typeof toPriceChangeType === 'function'
    ? toPriceChangeType
    : (changeType) => changeType;

  // Pass 1: every vehicle this run actually saw (this brand's dealers,
  // currently on the lot) — always wins for its own VIN, same as before.
  for (const [vin, cur] of currentInventory.entries()) {
    const prev = previousSnapshot[vin];
    let changeType = 'UNCHANGED';
    let priceDiff = 0;
    let oldPrice = null;
    let daysOnLot = 0;
    let firstSeen = todayDate;
    let priceHistory = [];

    if (!prev) {
      changeType = 'NEW_ARRIVAL';
      daysOnLot = 0;
      firstSeen = todayDate;
      priceHistory = cur.price ? [{ date: todayDate, price: cur.price }] : [];
      newArrivals.push(cur);
    } else {
      firstSeen = prev.firstSeen || todayDate;
      priceHistory = prev.priceHistory || [];
      const prevFirst = new Date(firstSeen).getTime();
      const now = new Date(todayDate).getTime();
      daysOnLot = Math.max(0, Math.floor((now - prevFirst) / (1000 * 60 * 60 * 24)));

      if (cur.price && prev.price && cur.price !== prev.price) {
        priceDiff = cur.price - prev.price;
        oldPrice = prev.price;
        priceHistory.push({ date: todayDate, price: cur.price });

        if (priceDiff < 0) {
          changeType = 'PRICE_DROP';
          priceDrops.push({ ...cur, oldPrice, priceDiff, daysOnLot });
        } else {
          changeType = 'PRICE_INCREASE';
          priceIncreases.push({ ...cur, oldPrice, priceDiff, daysOnLot });
        }
      }
    }

    const record = {
      ...cur,
      oldPrice,
      priceDiff,
      daysOnLot,
      firstSeen,
      lastSeen: todayDate,
      changeType,
      priceChangeType: changeTypeOf(changeType),
      priceHistory,
      status: 'ACTIVE',
      updatedAt: todayIso,
    };

    updatedSnapshot[vin] = record;
    allRecords.push(record);
  }

  // Pass 2: everything else already in the shared snapshot that this run
  // didn't just re-see. Scoped strictly to this run's own dealers.
  for (const [vin, prev] of Object.entries(previousSnapshot)) {
    if (currentInventory.has(vin)) continue; // handled in pass 1

    // configDealerName is the crawl-loop dealer key (reliable even for
    // shared-inventory dealer groups where the vehicle's own scraped
    // dealerName differs — see standalone.js's DDC extraction comment);
    // older records predate that field, so fall back to dealerName.
    const dealerKey = prev.configDealerName || prev.dealerName;

    if (!scopeDealerNames.has(dealerKey)) {
      // A different brand's dealer entirely — this run has no evidence
      // about it either way. Carry it forward byte-for-byte.
      updatedSnapshot[vin] = prev;
      allRecords.push(prev);
      continue;
    }

    if (prev.status !== 'ACTIVE') {
      // Already resolved SOLD_OR_REMOVED by an earlier run of this same
      // brand. Intentionally aged out rather than carried forever — the
      // day it went sold was already recorded in that day's changes file.
      continue;
    }

    if (failedDealerNames.has(dealerKey)) {
      // This vehicle's dealer produced zero real evidence this run
      // (bot-blocked, fetch failure, or extraction failure) — carry it
      // forward unchanged instead of marking it sold.
      updatedSnapshot[vin] = prev;
      allRecords.push(prev);
      continue;
    }

    // In scope, was ACTIVE, this run's crawl of its own dealer succeeded,
    // and it's genuinely no longer there: sold or removed.
    const soldRecord = {
      ...prev,
      status: 'SOLD_OR_REMOVED',
      changeType: 'SOLD',
      priceChangeType: 'SOLD',
      soldDate: todayDate,
      lastSeen: todayDate,
      updatedAt: todayIso,
    };
    updatedSnapshot[vin] = soldRecord;
    soldVehicles.push(soldRecord);
    allRecords.push(soldRecord);
  }

  return { updatedSnapshot, allRecords, newArrivals, priceDrops, priceIncreases, soldVehicles };
}
