// Overlay verified dealer hosts (name → official website).
//
// Sources:
//   - dealers/oem-dumps/ via src/oem_locator.js (official locator fetch)
//   - scrapers/lightsail-crawler/acura-dealers.json  (Acura locator dump)
//   - scrapers/lightsail-crawler/dealers.json        (Porsche directory)
//   - lib/verifiedVehicles.json                      (listing VDP hosts)
//   - CURATED_OVERLAY                                (name→host corrections
//     from in-repo audits, e.g. Porsche Princeton)
//
// Genesis / Stellantis / Ford / GM locators exist elsewhere in the repo;
// those brands stay OUT of the NJ crawl and are never read here.
//
// looksLikeBrandCityGuess() still flags brandofcity / volvocars{city}
// templates. Those hosts are allowed only when an OEM locator or listing
// published them — the invented seed is gone.

import fs from 'node:fs';
import path from 'node:path';

const BRAND_OF_CITY_RE =
  /^(honda|acura|toyota|lexus|kia|nissan|infiniti|subaru|mazda|volkswagen|vw|audi|bmw|mercedes|mercedesbenz|volvo|volvocars|porsche|mini|mitsubishi)of[a-z0-9]+/;
const VOLVOCARS_CITY_RE = /^volvocars[a-z0-9]+/;

const SOURCE_RANK = Object.freeze({
  'curated-overlay': 4,
  'listing-verified': 3,
  'oem-locator': 2,
  curated: 1,
  'pattern-guess': 0,
});

// In-repo corrections where the seed used a template host and a locator /
// listing / audit already recorded the real one.
const CURATED_OVERLAY = [
  { make: 'BMW', name: 'BMW of Morristown', domain: 'morristownbmw.com' },
  { make: 'Porsche', name: 'Porsche Princeton', domain: 'princetonporsche.com' },
  { make: 'Acura', name: 'Key Acura of Atlantic City', domain: 'keyacuraofatlanticcity.com' },
  { make: 'Mercedes-Benz', name: 'Mercedes-Benz of Paramus', domain: 'mercedesbenzparamus.com' },
  { make: 'Volvo', name: 'Prestige Volvo', domain: 'prestigevolvo.com' },
];

export function normalizeDealerHost(value) {
  return String(value || '')
    .replace(/^https?:\/\//i, '')
    .replace(/\/.*$/, '')
    .replace(/^www\./i, '')
    .toLowerCase()
    .trim();
}

export function overlayKey(make, name) {
  const brand = String(make || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
  const n = String(name || '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\b(the|of|at|and)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return `${brand}|${n}`;
}

export function looksLikeBrandCityGuess(dealer) {
  const host = normalizeDealerHost(dealer?.domain || dealer);
  if (!host) return false;
  const label = host.split('.')[0] || '';
  return BRAND_OF_CITY_RE.test(label) || VOLVOCARS_CITY_RE.test(label);
}

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    return fallback;
  }
}

function remember(map, make, name, domain, source) {
  const host = normalizeDealerHost(domain);
  const key = overlayKey(make, name);
  if (!host || !name || !make || !key.includes('|')) return;
  const prev = map.get(key);
  const rank = SOURCE_RANK[source] || 0;
  if (prev && (SOURCE_RANK[prev.source] || 0) > rank) return;
  map.set(key, { domain: host, source, name, make });
}

function loadListingVerified(repoRoot, map) {
  const file = path.join(repoRoot, 'lib', 'verifiedVehicles.json');
  const rows = readJson(file, []);
  if (!Array.isArray(rows)) return;
  for (const v of rows) {
    const loc = v.location || {};
    if (String(loc.state || '').toUpperCase() !== 'NJ') continue;
    const make = v.make;
    const name = loc.dealerName;
    let host = null;
    try {
      host = normalizeDealerHost(v.dealerUrl ? new URL(v.dealerUrl).hostname : '');
    } catch {
      host = null;
    }
    if (!host || !name || !make) continue;
    remember(map, make, name, host, 'listing-verified');
  }
}

function loadOemJson(filePath, map, { make: forcedMake = null } = {}) {
  const rows = readJson(filePath, []);
  if (!Array.isArray(rows)) return;
  for (const raw of rows) {
    if (String(raw.state || '').toUpperCase() !== 'NJ') continue;
    const make = forcedMake || raw.make;
    remember(map, make, raw.name, raw.domain, 'oem-locator');
  }
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

export function loadVerifiedNjDomainMap({ cwd = process.cwd() } = {}) {
  const crawlerRoot = crawlerRootFrom(cwd);
  const repoRoot = repoRootFrom(cwd);
  const map = new Map();

  loadOemJson(path.join(crawlerRoot, 'acura-dealers.json'), map, { make: 'Acura' });
  loadOemJson(path.join(crawlerRoot, 'dealers.json'), map, { make: 'Porsche' });
  loadListingVerified(repoRoot, map);

  for (const row of CURATED_OVERLAY) {
    remember(map, row.make, row.name, row.domain, 'curated-overlay');
  }
  return map;
}

export function applyVerifiedNjDomains(dealers, { cwd = process.cwd() } = {}) {
  const map = loadVerifiedNjDomainMap({ cwd });
  const replacements = [];
  const out = dealers.map((d) => {
    const hit = map.get(overlayKey(d.make, d.name));
    const current = normalizeDealerHost(d.domain);
    if (hit && hit.domain && hit.domain !== current) {
      replacements.push({
        name: d.name,
        make: d.make,
        from: current,
        to: hit.domain,
        source: hit.source,
      });
      return {
        ...d,
        domain: hit.domain,
        domainSource: hit.source,
        previousDomain: current,
      };
    }
    const source = hit
      ? hit.source
      : looksLikeBrandCityGuess(d)
        ? 'pattern-guess'
        : 'curated';
    return { ...d, domainSource: source };
  });
  return { dealers: out, replacements };
}
