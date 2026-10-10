// Per-state, per-brand dealer counts as the nightly write-<state>-dealer-files step will produce
// them, computed from dealers/oem-dumps (plus the in-repo locators and listing-verified hosts)
// without writing anything or touching the network.
//
// Every state policy's loader filters the same locator map through acceptNjDealer, so counting
// here gives the number of rooftops a state's dealer file will hold for a brand. A zero means that
// brand is silently skipped ("no dealers in dealers/<state>/<brand>.json") in that state tonight.

import { locatorRowsForState } from './oem_locator.js';
import { acceptNjDealer, canonicalBrandName } from './nj_policy.js';

export function countDealersByBrand(state, brands, { cwd = process.cwd() } = {}) {
  const counts = Object.fromEntries(brands.map((b) => [b, 0]));
  const seenHost = new Map(brands.map((b) => [b, new Set()]));
  for (const raw of locatorRowsForState(state, { cwd })) {
    const make = canonicalBrandName(raw.make);
    for (const brand of brands) {
      if (canonicalBrandName(brand) !== make) continue;
      if (!acceptNjDealer({ ...raw, make, state: 'NJ' }, { brand })) continue;
      const host = String(raw.domain || '').toLowerCase().replace(/^www\./, '');
      if (seenHost.get(brand).has(host)) continue;
      seenHost.get(brand).add(host);
      counts[brand] += 1;
    }
  }
  return counts;
}

export function coverageMatrix(states, brands, opts = {}) {
  return Object.fromEntries(states.map((s) => [s, countDealersByBrand(s, brands, opts)]));
}

// Pairs (state, brand) with no dealers at all.
export function coverageGaps(matrix) {
  const gaps = [];
  for (const [state, byBrand] of Object.entries(matrix)) {
    for (const [brand, n] of Object.entries(byBrand)) {
      if (n === 0) gaps.push({ state, brand });
    }
  }
  return gaps;
}
