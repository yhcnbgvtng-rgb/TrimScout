// Today-vs-yesterday price movement. Inventory records keep the existing
// changeType vocabulary (NEW_ARRIVAL / PRICE_DROP / PRICE_INCREASE /
// UNCHANGED / SOLD). The daily DOM/price index uses NEW for first sightings
// so the ops report matches PRICE_DROP / PRICE_INCREASE / UNCHANGED / NEW / SOLD.

export const PRICE_CHANGE_TYPES = Object.freeze({
  PRICE_DROP: 'PRICE_DROP',
  PRICE_INCREASE: 'PRICE_INCREASE',
  UNCHANGED: 'UNCHANGED',
  NEW: 'NEW',
  SOLD: 'SOLD',
});

export function priceChangeVsYesterday({ todayPrice = null, yesterdayPrice = null, isNew = false, isSold = false } = {}) {
  if (isSold) {
    return {
      priceChangeType: PRICE_CHANGE_TYPES.SOLD,
      oldPrice: yesterdayPrice ?? null,
      priceDiff: 0,
    };
  }
  if (isNew) {
    return {
      priceChangeType: PRICE_CHANGE_TYPES.NEW,
      oldPrice: null,
      priceDiff: 0,
    };
  }
  if (todayPrice && yesterdayPrice && todayPrice !== yesterdayPrice) {
    const priceDiff = todayPrice - yesterdayPrice;
    return {
      priceChangeType: priceDiff < 0 ? PRICE_CHANGE_TYPES.PRICE_DROP : PRICE_CHANGE_TYPES.PRICE_INCREASE,
      oldPrice: yesterdayPrice,
      priceDiff,
    };
  }
  return {
    priceChangeType: PRICE_CHANGE_TYPES.UNCHANGED,
    oldPrice: yesterdayPrice ?? null,
    priceDiff: 0,
  };
}

export function inventoryChangeTypeToPriceChangeType(changeType) {
  if (changeType === 'NEW_ARRIVAL') return PRICE_CHANGE_TYPES.NEW;
  if (changeType === 'SOLD' || changeType === 'SOLD_OR_REMOVED') return PRICE_CHANGE_TYPES.SOLD;
  if (changeType === 'PRICE_DROP' || changeType === 'PRICE_INCREASE' || changeType === 'UNCHANGED') {
    return changeType;
  }
  return PRICE_CHANGE_TYPES.UNCHANGED;
}
