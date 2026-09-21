// Utah dealer lists for the Lightsail crawler.
// Same IN/OUT brands and megadealer rules as every other state. Hosts come
// only from official OEM locator dumps and listing-verified VDPs — never
// brandofcity template guesses.

import fs from 'node:fs';
import path from 'node:path';
import {
  NJ_BRANDS_IN,
  acceptNjDealer,
  canonicalBrandName,
  isNjBrandOut,
  isMegadealerOrSuperstore,
  buildDealerRecord,
} from './nj_policy.js';
import { locatorRowsForState } from './oem_locator.js';
import { looksLikeBrandCityGuess } from './nj_verified_domains.js';

export { NJ_BRANDS_IN as UT_BRANDS_IN };

export function isUtDealer(dealer) {
  return String(dealer?.state || '').trim().toUpperCase() === 'UT';
}

export function acceptUtDealer(dealer, { brand = null } = {}) {
  if (!dealer || !isUtDealer(dealer)) return false;
  return acceptNjDealer({ ...dealer, state: 'NJ' }, { brand }) && isUtDealer(dealer);
}

export function loadUtDealers({ cwd = process.cwd(), brand = null } = {}) {
  if (brand && isNjBrandOut(brand)) return [];
  const out = [];
  const seenName = new Set();
  const seenHost = new Set();
  for (const raw of locatorRowsForState('UT', { cwd })) {
    const make = canonicalBrandName(raw.make);
    const dealer = {
      ...raw,
      make,
      state: 'UT',
    };
    if (!acceptUtDealer(dealer, { brand })) continue;
    if (looksLikeBrandCityGuess(dealer) && raw.source === 'pattern-guess') continue;
    const rec = buildDealerRecord(dealer);
    rec.domainSource = raw.source || 'oem-locator';
    const nameKey = `${String(rec.make).toLowerCase()}|${String(rec.name).toLowerCase()}`;
    const hostKey = String(rec.domain || '').toLowerCase().replace(/^www\./, '');
    if (seenName.has(nameKey) || seenHost.has(hostKey)) continue;
    seenName.add(nameKey);
    seenHost.add(hostKey);
    out.push(rec);
  }
  out.sort((a, b) => {
    const brandCmp = String(a.make).localeCompare(String(b.make));
    if (brandCmp !== 0) return brandCmp;
    return String(a.name).localeCompare(String(b.name));
  });
  return out;
}

export function writeUtDealerFiles(cwd = process.cwd()) {
  const root = path.resolve(cwd);
  const outDir = path.join(root, 'dealers', 'ut');
  fs.mkdirSync(outDir, { recursive: true });
  const written = [];
  for (const brandName of NJ_BRANDS_IN) {
    const dealers = loadUtDealers({ cwd: root, brand: brandName });
    const slug = canonicalBrandName(brandName).toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const dest = path.join(outDir, `${slug}.json`);
    fs.writeFileSync(dest, `${JSON.stringify(dealers, null, 2)}\n`);
    written.push({ brand: brandName, dest, count: dealers.length });
  }
  return written;
}

export { isMegadealerOrSuperstore };
