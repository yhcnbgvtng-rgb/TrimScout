// Stellantis is a crawl-scope umbrella (brands.js), not a make anyone shops by: a Jeep Wrangler must
// be stored as make=Jeep. Confirmed live 2026-10-01: ~19k in-stock dealer_inventory rows carried
// make="Stellantis" (buyer /search, admin filters and facets all listed it beside Jeep/Ram/Dodge/…).
// Two write paths put it there — a VIN-only match with no model label fell back to brand.name
// (brand_match.js), and roster-level `dealer.make = "Stellantis"` backfilled blank makes — and the
// upsert is `make = VALUES(make)`, so every nightly sync re-wrote it. This module is the single
// resolver used by the crawler AND by the deals-API write path (the API is the choke point that
// also catches stale shards and not-yet-updated boxes), and by the one-shot backfill script.
import { canonicalMake } from './ingestGuards.js';
import { resolveUmbrellaMake, reconcileMake } from './vinWmi.js';

export { resolveUmbrellaMake };

export const UMBRELLA_MAKE = 'Stellantis';

// Canonical spellings stored in dealer_inventory.make. The column's collation is case-insensitive,
// so Ram/RAM and FIAT/Fiat are the same filter value; we pick one spelling so facets show one entry.
const NAMEPLATE_BY_KEY = { jeep: 'Jeep', ram: 'Ram', dodge: 'Dodge', chrysler: 'Chrysler', fiat: 'FIAT' };

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

// The one entry point for every write path. Idempotent; never returns "Stellantis".
//  - nameplate spelling variants collapse to the canonical spelling (RAM/Ram → Ram, Fiat/FIAT → FIAT)
//  - the umbrella make is resolved from VIN/model
//  - any other make keeps its make, only its capitalization is canonicalized (LEXUS -> Lexus)
//  - then the make is checked against the VIN (vinWmi.js reconcileMake): contradicted or blank -> the VIN's make
// An unresolvable umbrella row yields null rather than re-storing the umbrella name.
export function normalizeMakeForWrite({ make, vin, model } = {}) {
  const np = canonicalNameplate(make);
  const named = np || (isUmbrellaMake(make) ? resolveUmbrellaMake({ vin, model }).make : canonicalMake(make));
  // Last step, every branch: a make the VIN contradicts (a Challenger stored as "GMC" because a GMC-roster dealer listed it) or a blank make is
  // taken from the VIN's WMI instead. A VIN the table does not know leaves the make as it is. See vinWmi.js.
  return reconcileMake({ make: named, vin, model }).make;
}
