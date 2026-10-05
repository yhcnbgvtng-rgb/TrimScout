// Ingest guards applied by the deals API's bulk write (handleInventoryBulk) — the one choke point every box's
// sync passes through, so they also catch stale shards and boxes that haven't been updated yet.
//
//   1. Price: a number that is plainly a parse error is dropped (price -> null), never clamped or "fixed".
//        - above $300,000 on a make that isn't an exotic/ultra-luxury marque (a $450k Camry is an error);
//          pre-1996 cars are exempt, because collectible cars legitimately sell above that;
//        - about ten times the vehicle's own MSRP (a decimal-point / extra-digit slip: msrp 45,000, price 450,000),
//          for any make.
//      There is deliberately NO minimum-price rule: a $2,500 used car is real (ingestSanitize.js, same stance).
//      The upsert keeps the previously stored price when the new one is null (COALESCE), so a guarded night leaves
//      the old value in place instead of writing a bad one. Rows already stored wrong need a separate backfill.
//   2. Make: one canonical spelling per make, so "LEXUS", "lexus" and "Lexus" are a single filter value.

export const PRICE_CEILING = 300_000;
export const CLASSIC_BEFORE_YEAR = 1996;
const MSRP_RATIO_LOW = 9;
const MSRP_RATIO_HIGH = 11;
const MIN_MSRP_FOR_RATIO = 5_000; // below this the "msrp" is usually a fee/teaser, not a real MSRP, so a ratio proves nothing

const keyOf = (s) => String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]/g, '');

// Makes whose cars routinely list above the ceiling. Mainstream/luxury makes (Porsche, Mercedes-Benz, Cadillac, ...)
// are NOT here: their six-figure cars stay under $300k, so a higher number is still an error.
const EXOTIC_MAKES = new Set([
  'ferrari', 'lamborghini', 'bentley', 'rollsroyce', 'mclaren', 'astonmartin', 'bugatti', 'maybach', 'lotus',
  'koenigsegg', 'pagani', 'rimac', 'spyker', 'mansory',
]);

export function isExoticMake(make) {
  return EXOTIC_MAKES.has(keyOf(make));
}

/**
 * @param {{price?: number|null, msrp?: number|null, make?: string|null, year?: number|null}} row  already-integer values
 * @returns {{price: number|null, msrp: number|null, reason: null|'over-ceiling'|'x10-msrp'}}
 */
export function guardPrice({ price = null, msrp = null, make = null, year = null } = {}) {
  if (!Number.isFinite(price)) return { price: price ?? null, msrp, reason: null };
  if (Number.isFinite(msrp) && msrp >= MIN_MSRP_FOR_RATIO) {
    const ratio = price / msrp;
    if (ratio >= MSRP_RATIO_LOW && ratio <= MSRP_RATIO_HIGH) return { price: null, msrp, reason: 'x10-msrp' };
  }
  const classic = Number.isFinite(year) && year < CLASSIC_BEFORE_YEAR;
  if (price > PRICE_CEILING && !isExoticMake(make) && !classic) return { price: null, msrp, reason: 'over-ceiling' };
  return { price, msrp, reason: null };
}

// Canonical spellings. Aligned with brands.js (Mini, INEOS, McLaren) and stellantisMake.js (FIAT, Ram).
const CANONICAL_MAKES = [
  'Acura', 'Alfa Romeo', 'Aston Martin', 'Audi', 'Bentley', 'BMW', 'Bugatti', 'Buick', 'Cadillac', 'Chevrolet', 'Chrysler',
  'Dodge', 'Ferrari', 'FIAT', 'Fisker', 'Ford', 'Genesis', 'GMC', 'Honda', 'Hummer', 'Hyundai', 'INEOS', 'Infiniti', 'Isuzu',
  'Jaguar', 'Jeep', 'Kia', 'Lamborghini', 'Land Rover', 'Lexus', 'Lincoln', 'Lotus', 'Lucid', 'Maserati', 'Maybach', 'Mazda',
  'McLaren', 'Mercedes-Benz', 'Mercury', 'Mini', 'Mitsubishi', 'Nissan', 'Oldsmobile', 'Plymouth', 'Polestar', 'Pontiac',
  'Porsche', 'Ram', 'Rivian', 'Rolls-Royce', 'Saab', 'Saturn', 'Scion', 'Smart', 'Subaru', 'Suzuki', 'Tesla', 'Toyota',
  'VinFast', 'Volkswagen', 'Volvo',
];
const MAKE_BY_KEY = new Map(CANONICAL_MAKES.map((m) => [keyOf(m), m]));
for (const [alias, make] of [['mercedes', 'Mercedes-Benz'], ['mercedesbenz', 'Mercedes-Benz'], ['chevy', 'Chevrolet'], ['vw', 'Volkswagen'], ['landrover', 'Land Rover']]) {
  MAKE_BY_KEY.set(alias, make);
}

const titleWord = (w) => (w.length <= 3 ? w : w[0].toUpperCase() + w.slice(1).toLowerCase());

/**
 * One spelling per make. Known makes (any case/spacing/punctuation) map to the canonical spelling. An unknown make
 * written entirely in upper or lower case is Title-Cased ("LEXUSX" -> "Lexusx"; words of three letters or fewer keep
 * their case, so an acronym like "MG" survives); a mixed-case unknown make is left as the page wrote it.
 */
export function canonicalMake(raw) {
  if (raw == null) return null;
  const s = String(raw).trim().replace(/\s+/g, ' ');
  if (!s) return null;
  const known = MAKE_BY_KEY.get(keyOf(s));
  if (known) return known;
  if (s === s.toUpperCase() || s === s.toLowerCase()) return s.split(/([ -])/).map((p) => (/^[ -]$/.test(p) ? p : titleWord(p))).join('');
  return s;
}
