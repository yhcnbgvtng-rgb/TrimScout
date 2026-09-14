// New York dealer lists for the Lightsail crawler.
// Same IN/OUT brands and megadealer rules as NJ. Hosts come only from
// in-repo OEM locator dumps and listing-verified VDPs — never brandofcity
// template guesses.

import fs from 'node:fs';
import path from 'node:path';
import {
  NJ_BRANDS_IN,
  acceptNjDealer,
  canonicalBrandName,
  isNjBrandIn,
  isNjBrandOut,
  isMegadealerOrSuperstore,
  buildDealerRecord,
} from './nj_policy.js';
import { looksLikeBrandCityGuess, normalizeDealerHost } from './nj_verified_domains.js';

export { NJ_BRANDS_IN as NY_BRANDS_IN };

export function isNyDealer(dealer) {
  return String(dealer?.state || '').trim().toUpperCase() === 'NY';
}

export function acceptNyDealer(dealer, { brand = null } = {}) {
  if (!dealer || !isNyDealer(dealer)) return false;
  return acceptNjDealer({ ...dealer, state: 'NJ' }, { brand }) && isNyDealer(dealer);
}

function readJsonArray(filePath) {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function hostFromUrl(url) {
  try {
    return normalizeDealerHost(new URL(url).hostname);
  } catch {
    return null;
  }
}

function dealerKey(d) {
  return `${String(d.make || '').toLowerCase()}|${String(d.name || '').toLowerCase()}|${normalizeDealerHost(d.domain)}`;
}

function crawlerRootFrom(cwd) {
  const root = path.resolve(cwd || process.cwd());
  if (fs.existsSync(path.join(root, 'acura-dealers.json'))) return root;
  const nested = path.join(root, 'scrapers', 'lightsail-crawler');
  if (fs.existsSync(path.join(nested, 'acura-dealers.json'))) return nested;
  return root;
}

function repoRootFrom(cwd) {
  const start = path.resolve(cwd || process.cwd());
  let dir = start;
  for (let i = 0; i < 6; i++) {
    if (fs.existsSync(path.join(dir, 'lib', 'verifiedVehicles.json'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return path.resolve(start, '..', '..');
}

function pushDealer(out, seen, raw, { make, source, brand }) {
  const host = normalizeDealerHost(raw.domain);
  if (!host) return;
  const dealer = {
    ...raw,
    domain: host,
    make: canonicalBrandName(make || raw.make) || make,
    state: 'NY',
  };
  if (!acceptNyDealer(dealer, { brand })) return;
  if (looksLikeBrandCityGuess(dealer) && source === 'pattern-guess') return;
  const key = dealerKey(dealer);
  if (seen.has(key)) return;
  seen.add(key);
  const rec = buildDealerRecord(dealer);
  rec.domainSource = source;
  out.push(rec);
}

export function loadNyDealers({ cwd = process.cwd(), brand = null } = {}) {
  if (brand && isNjBrandOut(brand)) return [];
  const crawlerRoot = crawlerRootFrom(cwd);
  const repoRoot = repoRootFrom(cwd);
  const seen = new Set();
  const out = [];

  for (const raw of readJsonArray(path.join(crawlerRoot, 'acura-dealers.json'))) {
    if (String(raw.state || '').toUpperCase() !== 'NY') continue;
    pushDealer(out, seen, raw, { make: 'Acura', source: 'oem-locator', brand });
  }

  for (const raw of readJsonArray(path.join(crawlerRoot, 'dealers.json'))) {
    if (String(raw.state || '').toUpperCase() !== 'NY') continue;
    const make = raw.make || 'Porsche';
    if (!isNjBrandIn(make)) continue;
    pushDealer(out, seen, raw, { make, source: 'oem-locator', brand });
  }

  const listings = readJsonArray(path.join(repoRoot, 'lib', 'verifiedVehicles.json'));
  const byName = new Map();
  for (const v of listings) {
    const loc = v.location || {};
    if (String(loc.state || '').toUpperCase() !== 'NY') continue;
    const make = canonicalBrandName(v.make);
    if (!make || !isNjBrandIn(make)) continue;
    const host = hostFromUrl(v.dealerUrl);
    const name = loc.dealerName;
    if (!host || !name) continue;
    const key = `${make}|${name}|${host}`;
    if (!byName.has(key)) {
      byName.set(key, {
        name,
        city: loc.city || null,
        domain: host,
        make,
        state: 'NY',
      });
    }
  }
  for (const raw of byName.values()) {
    pushDealer(out, seen, raw, { make: raw.make, source: 'listing-verified', brand });
  }

  return out.sort((a, b) => {
    const brandCmp = String(a.make).localeCompare(String(b.make));
    if (brandCmp !== 0) return brandCmp;
    return String(a.name).localeCompare(String(b.name));
  });
}

export function writeNyDealerFiles(cwd = process.cwd()) {
  const root = path.resolve(cwd);
  const outDir = path.join(root, 'dealers', 'ny');
  fs.mkdirSync(outDir, { recursive: true });
  const written = [];
  for (const brandName of NJ_BRANDS_IN) {
    const dealers = loadNyDealers({ cwd: root, brand: brandName });
    const slug = canonicalBrandName(brandName).toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const dest = path.join(outDir, `${slug}.json`);
    fs.writeFileSync(dest, `${JSON.stringify(dealers, null, 2)}\n`);
    written.push({ brand: brandName, dest, count: dealers.length });
  }
  return written;
}
