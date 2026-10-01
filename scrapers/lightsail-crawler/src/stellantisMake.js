// Stellantis is a crawl-scope umbrella (brands.js), not a make anyone shops by: a Jeep Wrangler must
// be stored as make=Jeep. Confirmed live 2026-10-01: ~19k in-stock dealer_inventory rows carried
// make="Stellantis" (buyer /search, admin filters and facets all listed it beside Jeep/Ram/Dodge/…).
// Two write paths put it there — a VIN-only match with no model label fell back to brand.name
// (brand_match.js), and roster-level `dealer.make = "Stellantis"` backfilled blank makes — and the
// upsert is `make = VALUES(make)`, so every nightly sync re-wrote it. This module is the single
// resolver used by the crawler AND by the deals-API write path (the API is the choke point that
// also catches stale shards and not-yet-updated boxes), and by the one-shot backfill script.
import { VIN5_NAMEPLATE, VIN3_PURE_NAMEPLATE } from './stellantisVinTable.js';

export const UMBRELLA_MAKE = 'Stellantis';

// Canonical spellings stored in dealer_inventory.make. The column's collation is case-insensitive,
// so Ram/RAM and FIAT/Fiat are the same filter value; we pick one spelling so facets show one entry.
const NAMEPLATE_BY_KEY = { jeep: 'Jeep', ram: 'Ram', dodge: 'Dodge', chrysler: 'Chrysler', fiat: 'FIAT' };

const VIN5 = new Map();
for (const [nameplate, list] of Object.entries(VIN5_NAMEPLATE)) {
  for (const p of list.split(' ')) VIN5.set(p, nameplate);
}

// WMIs (VIN chars 1-3) that belong to Stellantis. Anything else on an umbrella-tagged row is a
// vehicle some other manufacturer built (a trade-in on a multi-franchise lot).
const STELLANTIS_WMI = new Set([
  '1A4', '1A8', '1B3', '1B4', '1B6', '1B7', '1C3', '1C4', '1C6', '1D3', '1D4', '1D7', '1D8', '1J4', '1J8', '2A4', '2A8',
  '2B3', '2B7', '2C3', '2C4', '2C8', '2D4', '2D8', '3A4', '3A8', '3B7', '3C3', '3C4', '3C6', '3C7', '3D3',
  '3D4', '3D7', 'ZAC', 'ZFA', 'ZFB', 'ZFC', '1P3', '2P3', '1P4',
]);

// Conservative manufacturer table for non-Stellantis WMIs that identify the make by themselves.
// Shared-WMI cases (5N1 Nissan/Infiniti, 5XY Kia/Hyundai, …) are deliberately absent: guessing wrong
// is worse than leaving the row for the reported residual list.
const OTHER_WMI_MAKE = {
  Ford: ['1FA', '1FB', '1FC', '1FD', '1F6', '1F9', '1FM', '1FT', '2FM', '2FT', '3FA', '3FM', '3FT', '1ZV', '2FA', '3FD'],
  Chevrolet: ['1G1', '1GC', '1GN', '3GC', '3GN', '3G1', 'KL7', 'KL1', '2G1', '1GB', '3GB', '2GC', '2GN'],
  GMC: ['1GT', '3GT', '1GK', '3GK', '2GT', '2GK', '1GD'],
  Cadillac: ['1GY', '1G6'],
  Buick: ['1G4', 'KL4', '5GA', 'W04'],
  Toyota: ['5YF', '4T1', '4T3', '5TD', '5TF', '3TM', '3TY', 'JTM', 'JTE', '2T3', '2T1'],
  Hyundai: ['KM8', 'KMH', '5NM', '5NP'],
  Kia: ['KND', 'KNA', 'KNM', '3KP'],
  Subaru: ['JF1', 'JF2', '4S3', '4S4'],
  'Land Rover': ['SAL'],
  Nissan: ['1N4', '1N6', '3N1', 'JN8', '3N6'],
  Honda: ['2HG', '2HK', '2HJ', '5FN', '5J6', '19X', '1HG', 'SHH'],
  Mazda: ['JM1', 'JM3', '3MD', '3MZ'],
  Volkswagen: ['1VW', '3VW', 'WVW', '3VV', 'WVG'],
  BMW: ['WBA', 'WBS', 'WBX', '5UX', '5YM', '5UM'],
  'Mercedes-Benz': ['W1K', 'W1N', 'WDD', 'WDC', '4JG', '55S', 'W1Y'],
  Audi: ['WAU', 'WA1', 'TRU'],
  Volvo: ['YV1', 'YV4', '7JR'],
  Acura: ['19U', '19V', 'JH4', '5J8'],
  Lexus: ['JTH', 'JTJ', '2T2', '58A'],
  Mini: ['WMW', 'WMZ'],
  Porsche: ['WP0', 'WP1'],
  Tesla: ['5YJ', '7SA', 'LRW'],
  Jaguar: ['SAJ'],
  Lincoln: ['5LM', '2LM', '3LN', '5L1'],
  Mitsubishi: ['JA3', 'JA4', 'JA7', '4A3', '4A4'],
};
const OTHER_WMI = new Map();
for (const [make, list] of Object.entries(OTHER_WMI_MAKE)) for (const w of list) OTHER_WMI.set(w, make);

// Model → nameplate for rows whose VIN prefix isn't in the learned table (a new platform year).
// Full-word patterns only; ambiguous bare numerics (300, 500) are left to the VIN.
const MODEL_RULES = [
  [/\b(wrangler|gladiator|cherokee|compass|renegade|wagoneer|patriot|liberty|commander)\b/i, 'Jeep'],
  [/\b(ram|promaster|dakota|rampage)\b/i, 'Ram'],
  [/\b(charger|challenger|durango|journey|caravan|hornet|avenger|nitro|viper|magnum|stratus|neon)\b/i, 'Dodge'],
  [/\b(pacifica|voyager|town (&|and) country|sebring|pt cruiser|aspen)\b/i, 'Chrysler'],
];

export function canonicalNameplate(rawMake) {
  const key = String(rawMake || '').trim().toLowerCase();
  if (!key) return null;
  if (NAMEPLATE_BY_KEY[key]) return NAMEPLATE_BY_KEY[key];
  // "RAM Trucks", "Jeep®", "Chrysler Group": a nameplate word at the start of the label.
  const first = key.replace(/[^a-z ]/g, ' ').trim().split(/\s+/)[0];
  return NAMEPLATE_BY_KEY[first] || null;
}

export function isUmbrellaMake(rawMake) {
  return String(rawMake || '').trim().toLowerCase() === UMBRELLA_MAKE.toLowerCase();
}

// Resolve the real make for an umbrella-make vehicle. Returns { make, via } or { make: null, via: null }.
export function resolveUmbrellaMake({ vin, model } = {}) {
  const v = String(vin || '').trim().toUpperCase();
  const wmi = v.slice(0, 3);
  if (v.length >= 5 && VIN5.has(v.slice(0, 5))) return { make: VIN5.get(v.slice(0, 5)), via: 'vin5' };
  const foreign = wmi && !STELLANTIS_WMI.has(wmi) && OTHER_WMI.has(wmi);
  if (foreign) return { make: OTHER_WMI.get(wmi), via: 'other-wmi' };
  if (model && (!wmi || STELLANTIS_WMI.has(wmi))) {
    const m = String(model).trim();
    for (const [re, np] of MODEL_RULES) if (re.test(m)) return { make: np, via: 'model' };
  }
  if (VIN3_PURE_NAMEPLATE[wmi]) return { make: VIN3_PURE_NAMEPLATE[wmi], via: 'vin3' };
  return { make: null, via: null };
}

// The one entry point for every write path. Idempotent; never returns "Stellantis".
//  - nameplate spelling variants collapse to the canonical spelling (RAM/Ram → Ram, Fiat/FIAT → FIAT)
//  - the umbrella make is resolved from VIN/model
//  - any other make (a Ford trade-in the crawler already labeled correctly, or blank) is untouched
// An unresolvable umbrella row yields null rather than re-storing the umbrella name.
export function normalizeMakeForWrite({ make, vin, model } = {}) {
  const np = canonicalNameplate(make);
  if (np) return np;
  if (isUmbrellaMake(make)) return resolveUmbrellaMake({ vin, model }).make;
  const raw = String(make == null ? '' : make).trim();
  return raw || null;
}
