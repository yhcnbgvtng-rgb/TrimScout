// Ingest guards applied by the deals API's bulk write (handleInventoryBulk) — the one choke point every box's
// sync passes through, so they also catch stale shards and boxes that haven't been updated yet.
//
//   1. Price: a number that is plainly a parse error is dropped (price -> null), never clamped or "fixed".
//        - above $300,000 on a make that isn't an exotic, unless the price is supported by the row's own MSRP (<= 2x a usable
//          MSRP) or the car is a known GT/collectible (Porsche, Corvette ZR1, Viper, G 63, ...) — a $450k Camry with a $30k MSRP is
//          an error; pre-1996 cars are exempt, because collectible cars legitimately sell above that;
//        - about ten times the vehicle's own MSRP (a decimal-point / extra-digit slip): whichever of the two is outside the
//          normal range is the broken one — price 450,000 vs msrp 45,000 nulls the PRICE; price 75,170 vs msrp 7,514 nulls the MSRP.
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

// Makes whose cars routinely list above the ceiling.
const EXOTIC_MAKES = new Set([
  'ferrari', 'lamborghini', 'bentley', 'rollsroyce', 'mclaren', 'astonmartin', 'bugatti', 'maybach', 'lotus',
  'koenigsegg', 'pagani', 'rimac', 'spyker', 'mansory',
]);
// Porsche's GT cars (911 GT3 RS/GT2 RS, 918, ...) really do list above $300k, usually at 0.8-1.5x their own MSRP, and the
// feed sometimes carries a nonsense MSRP for them (498, 799), so a ceiling there would erase real prices. Found in the live
// data 2026-10-07: 175 in-stock Porsches over $300k.
const CEILING_EXEMPT_MAKES = new Set(['porsche']);
// Collectible / halo models of mainstream makes whose used prices pass $300k (checked against the live data: Corvette ZR1/ZR1X,
// Dodge Viper, Mercedes-AMG G 63 / Black Series, Acura NSX, Ford GT, Lexus LFA, Nissan GT-R).
const COLLECTIBLE_MODEL_RE = /\b(viper|zr1x?|ford gt|nsx|lfa|gt-?r|black series|g[ -]?6[37]|amg gt)\b/i;

export function isExoticMake(make) {
  return EXOTIC_MAKES.has(keyOf(make));
}

// A price "supported by its own MSRP": the MSRP is a usable number and the price is not more than twice it. A $450k Camry with no
// MSRP (or an MSRP of $30k) is unsupported; a $330k Corvette ZR1X with a $210k MSRP is supported.
const SUPPORT_RATIO = 2;
const NORMAL_MSRP_FLOOR = 15_000; // below this an "MSRP" is a fee/teaser/typo for any car this site lists
const NORMAL_PRICE_BAND = [15_000, PRICE_CEILING];

/**
 * @param {{price?: number|null, msrp?: number|null, make?: string|null, model?: string|null, year?: number|null}} row  already-integer values
 * @returns {{price: number|null, msrp: number|null, reason: null|'over-ceiling'|'x10-msrp'|'x10-msrp-bad-msrp'}}
 *   Only ever nulls the field that is implausible; a correct price is never discarded because the MSRP is the corrupt one.
 */
export function guardPrice({ price = null, msrp = null, make = null, model = null, year = null } = {}) {
  if (!Number.isFinite(price)) return { price: price ?? null, msrp, reason: null };

  // ~10x apart (9-11x). Which one is wrong? The one outside the normal range for a vehicle. Live data 2026-10-07: of 33 such
  // pairs, 9 had the PRICE broken (Explorer $660,740 vs msrp $66,074) and 24 had the MSRP broken (Ram 3500 price $75,170 vs
  // msrp $7,514; Gladiator $56,995 vs $5,918) — nulling the price at 10x would have erased 24 correct prices.
  if (Number.isFinite(msrp) && msrp >= MIN_MSRP_FOR_RATIO) {
    const ratio = price / msrp;
    if (ratio >= MSRP_RATIO_LOW && ratio <= MSRP_RATIO_HIGH) {
      const priceNormal = price >= NORMAL_PRICE_BAND[0] && price <= NORMAL_PRICE_BAND[1];
      if (msrp < NORMAL_MSRP_FLOOR && priceNormal) return { price, msrp: null, reason: 'x10-msrp-bad-msrp' };
      return { price: null, msrp, reason: 'x10-msrp' };
    }
  }

  const classic = Number.isFinite(year) && year < CLASSIC_BEFORE_YEAR;
  if (price > PRICE_CEILING && !isExoticMake(make) && !CEILING_EXEMPT_MAKES.has(keyOf(make)) && !classic && !COLLECTIBLE_MODEL_RE.test(`${make || ''} ${model || ''}`)) {
    const supported = Number.isFinite(msrp) && msrp >= NORMAL_MSRP_FLOOR && price <= msrp * SUPPORT_RATIO;
    if (!supported) return { price: null, msrp, reason: 'over-ceiling' };
  }
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
