// Parser-side price guard: runs in the crawler on every parsed vehicle, before it reaches the inventory shard. It exists because the
// deals-API ingest guard (ingestGuards.js) only runs when that server is current, and junk prices were still stored: Hyundai of
// Downtown LA's Palisade and IONIQ 9 at $1.25-1.62M, a $3.6M Bronco Sport (PA), an Explorer (OH), a $3.5M Prevost.
//
// A price is REJECTED (-> null, never clamped or "fixed"; the upsert keeps the last stored price when the new one is null) when
//   1. it is more than 5x the car's previous crawled price, or more than 5x its own MSRP — a decimal/extra-digit slip or a
//      stock-number / phone-number scrape moves a price by far more than any real repricing does;
//   2. it is over the absolute ceiling for its make (volume brands 150k, everything else 300k; exotics, Porsche, pre-1996 cars and
//      known collectibles are exempt) unless its own MSRP supports it (price <= 2x a usable MSRP that is itself under 2x the ceiling).
// An MSRP that is itself implausible (a fee or typo under 15k) never causes the price to be rejected; ratios use only usable references.

import { COLLECTIBLE_MODEL_RE, CEILING_EXEMPT_MAKES, CLASSIC_BEFORE_YEAR, isExoticMake, keyOf } from './ingestGuards.js';

export const MAX_PRICE_JUMP = 5;
export const DEFAULT_CEILING = 300_000;
export const VOLUME_CEILING = 150_000;
const MIN_PREV_PRICE = 5_000;   // a previous price under this is a teaser/placeholder, not evidence of the car's real price
const MIN_USABLE_MSRP = 15_000; // same floor as ingestGuards.js NORMAL_MSRP_FLOOR
const MSRP_SUPPORT_RATIO = 2;

// Makes whose cars do not list anywhere near the default ceiling (top real price of any of them is under ~$100k).
const VOLUME_MAKES = new Set([
  'hyundai', 'kia', 'toyota', 'honda', 'nissan', 'mazda', 'subaru', 'mitsubishi', 'volkswagen', 'mini', 'fiat', 'buick',
  'chrysler', 'suzuki', 'scion', 'saturn', 'pontiac', 'mercury', 'oldsmobile', 'plymouth', 'isuzu', 'vinfast', 'smart',
]);

/** Absolute ceiling for a make; null when the make has none (exotics, Porsche). */
export function ceilingForMake(make) {
  const k = keyOf(make);
  if (isExoticMake(make) || CEILING_EXEMPT_MAKES.has(k)) return null;
  return VOLUME_MAKES.has(k) ? VOLUME_CEILING : DEFAULT_CEILING;
}

const num = (v) => (Number.isFinite(Number(v)) && v !== null && v !== '' ? Number(v) : null);

/**
 * @param {{price?: number|null, msrp?: number|null, prevPrice?: number|null, make?: string|null, model?: string|null, year?: number|null}} row
 * @returns {{ reject: boolean, reason: null|'over-5x-previous-price'|'over-5x-msrp'|'over-make-ceiling', limit: number|null, ref: number|null }}
 */
export function guardParsedPrice({ price, msrp = null, prevPrice = null, make = null, model = null, year = null } = {}) {
  const p = num(price);
  const none = { reject: false, reason: null, limit: null, ref: null };
  if (p === null || p <= 0) return none;
  const prev = num(prevPrice);
  const m = num(msrp);

  if (prev !== null && prev >= MIN_PREV_PRICE && p > prev * MAX_PRICE_JUMP) {
    return { reject: true, reason: 'over-5x-previous-price', limit: prev * MAX_PRICE_JUMP, ref: prev };
  }
  if (m !== null && m >= MIN_USABLE_MSRP && p > m * MAX_PRICE_JUMP) {
    return { reject: true, reason: 'over-5x-msrp', limit: m * MAX_PRICE_JUMP, ref: m };
  }

  const ceiling = ceilingForMake(make);
  const classic = num(year) !== null && year < CLASSIC_BEFORE_YEAR;
  if (ceiling !== null && p > ceiling && !classic && !COLLECTIBLE_MODEL_RE.test(`${make || ''} ${model || ''}`)) {
    // An MSRP can only vouch for the price if it is itself believable: several parsers copy the price into msrp, so a junk price
    // arrives with a junk MSRP equal to it.
    const supported = m !== null && m >= MIN_USABLE_MSRP && m <= ceiling * MSRP_SUPPORT_RATIO && p <= m * MSRP_SUPPORT_RATIO;
    if (!supported) return { reject: true, reason: 'over-make-ceiling', limit: ceiling, ref: m };
  }
  return none;
}

/**
 * Applies the guard to a parsed vehicle in place: a rejected price (and an MSRP that is just a copy of it, or itself over the ceiling)
 * becomes null. Returns the verdict so the caller can log it.
 * @param {{price?: number|null, msrp?: number|null, make?: string, model?: string, year?: number|null}} vehicle
 * @param {{price?: number|null}|undefined} prev the previous crawl's record for the same VIN
 */
export function applyParsedPriceGuard(vehicle, prev) {
  const verdict = guardParsedPrice({ price: vehicle.price, msrp: vehicle.msrp, prevPrice: prev?.price ?? null, make: vehicle.make, model: vehicle.model, year: vehicle.year });
  if (!verdict.reject) return verdict;
  const rejected = vehicle.price;
  vehicle.price = null;
  if (vehicle.msrp === rejected) vehicle.msrp = null;
  else if (guardParsedPrice({ price: vehicle.msrp, make: vehicle.make, model: vehicle.model, year: vehicle.year }).reject) vehicle.msrp = null;
  return { ...verdict, rejectedPrice: rejected };
}

export function describePriceRejection(vehicle, verdict) {
  const ref = verdict.ref ? `, reference ${verdict.ref}` : '';
  return `💸 price guard: ${vehicle.vin} ${vehicle.year || ''} ${vehicle.make || ''} ${vehicle.model || ''} at ${vehicle.dealerName || 'unknown dealer'}: price ${verdict.rejectedPrice} rejected (${verdict.reason}, limit ${verdict.limit}${ref}); price left blank.`.replace(/\s+/g, ' ');
}
