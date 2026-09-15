// Shared OEM dealer-locator dump loader.
//
// Hosts come only from official brand locators (live fetch or in-repo dumps)
// and listing-verified VDP hosts. Invented brandofcity.com templates are
// never added here. Detect-only: a 403/WAF from a locator is recorded, not
// retried with a different client.

import fs from 'node:fs';
import path from 'node:path';
import { normalizeDealerHost, overlayKey } from './nj_verified_domains.js';
import { SUPPORTED_STATES } from './states.js';

const SOURCE_RANK = Object.freeze({
  'curated-overlay': 4,
  'oem-locator': 3,
  'listing-verified': 2,
});

// Known in-repo host corrections (locator/listing/audit). Applied only when
// the rooftop already exists from a locator or listing — never used to invent
// a desk.
const CURATED_OVERLAY = [
  { make: 'BMW', name: 'BMW of Morristown', domain: 'morristownbmw.com' },
  { make: 'Porsche', name: 'Porsche Princeton', domain: 'princetonporsche.com' },
  { make: 'Acura', name: 'Key Acura of Atlantic City', domain: 'keyacuraofatlanticcity.com' },
  { make: 'Mercedes-Benz', name: 'Mercedes-Benz of Paramus', domain: 'mercedesbenzparamus.com' },
  { make: 'Volvo', name: 'Prestige Volvo', domain: 'prestigevolvo.com' },
];

const OEM_SITE_HOSTS = new Set([
  'mitsubishicars.com',
  'toyota.com',
  'lexus.com',
  'mbusa.com',
  'honda.com',
  'acura.com',
  'porsche.com',
  'subaru.com',
  'kia.com',
  'nissanusa.com',
  'infinitiusa.com',
  'mazdausa.com',
  'vw.com',
  'audiusa.com',
  'bmwusa.com',
  'miniusa.com',
  'volvocars.com',
]);

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    return fallback;
  }
}

function readJsonArray(filePath) {
  const parsed = readJson(filePath, []);
  return Array.isArray(parsed) ? parsed : [];
}

export function crawlerRootFrom(cwd) {
  const root = path.resolve(cwd || process.cwd());
  if (fs.existsSync(path.join(root, 'acura-dealers.json'))) return root;
  const nested = path.join(root, 'scrapers', 'lightsail-crawler');
  if (fs.existsSync(path.join(nested, 'acura-dealers.json'))) return nested;
  return root;
}

export function repoRootFrom(cwd) {
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

export function oemDumpsDir(cwd) {
  return path.join(crawlerRootFrom(cwd), 'dealers', 'oem-dumps');
}

export function hostFromUrl(url) {
  if (!url) return null;
  try {
    const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(url) ? url : `https://${url}`;
    return normalizeDealerHost(new URL(withScheme).hostname);
  } catch {
    return normalizeDealerHost(url);
  }
}

export function isOemMarketingHost(host) {
  const h = normalizeDealerHost(host);
  if (!h) return true;
  return OEM_SITE_HOSTS.has(h);
}

// Dedup key must include state: dealer groups routinely reuse the exact
// same trading name in more than one state (confirmed 2026-09-15 adding
// GA — "Kia Autosport" is a real, distinct rooftop in both Pensacola, FL
// and Columbus, GA; "Rick Case Kia" likewise in Sunrise, FL and Duluth,
// GA). A state-less key silently collapsed those into one entry and
// dropped a real rooftop — state-scoping it is the actual fix, not a
// per-state special case. applyCuratedOverlay() below still matches by
// make+name alone (CURATED_OVERLAY entries don't carry a state), but that
// scan now iterates every state-scoped entry rather than relying on this
// key's shape.
function stateScopedKey(make, name, state) {
  return `${state}|${overlayKey(make, name)}`;
}

function remember(map, row, source) {
  const make = String(row.make || '').trim();
  const host = normalizeDealerHost(row.domain);
  const name = String(row.name || '').trim();
  const state = String(row.state || '').trim().toUpperCase();
  if (!make || !host || !name || !state) return;
  if (isOemMarketingHost(host)) return;
  const key = stateScopedKey(make, name, state);
  const prev = map.get(key);
  const rank = SOURCE_RANK[source] || 0;
  if (prev && (SOURCE_RANK[prev.source] || 0) > rank) return;
  map.set(key, {
    name,
    city: row.city || null,
    state,
    make,
    domain: host,
    lat: row.lat ?? null,
    lng: row.lng ?? null,
    source,
    id: row.id || null,
  });
}

function loadDumpFiles(crawlerRoot, map) {
  const dir = path.join(crawlerRoot, 'dealers', 'oem-dumps');
  if (!fs.existsSync(dir)) return;
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith('.json') || name.startsWith('_')) continue;
    for (const raw of readJsonArray(path.join(dir, name))) {
      remember(map, raw, raw.source || 'oem-locator');
    }
  }
}

function loadInRepoLocators(crawlerRoot, map) {
  for (const raw of readJsonArray(path.join(crawlerRoot, 'acura-dealers.json'))) {
    remember(map, { ...raw, make: 'Acura', domain: raw.domain }, 'oem-locator');
  }
  for (const raw of readJsonArray(path.join(crawlerRoot, 'dealers.json'))) {
    remember(map, { ...raw, make: raw.make || 'Porsche', domain: raw.domain }, 'oem-locator');
  }
}

function loadListingVerified(repoRoot, map, state) {
  const rows = readJsonArray(path.join(repoRoot, 'lib', 'verifiedVehicles.json'));
  for (const v of rows) {
    const loc = v.location || {};
    const st = String(loc.state || '').toUpperCase();
    if (state && st !== state) continue;
    if (!SUPPORTED_STATES.includes(st)) continue;
    const host = hostFromUrl(v.dealerUrl);
    const name = loc.dealerName;
    if (!host || !name || !v.make) continue;
    remember(map, {
      name,
      city: loc.city || null,
      state: st,
      make: v.make,
      domain: host,
    }, 'listing-verified');
  }
}

function applyCuratedOverlay(map) {
  for (const row of CURATED_OVERLAY) {
    const wantKey = overlayKey(row.make, row.name);
    // CURATED_OVERLAY entries carry no state (they're one-off host
    // corrections, not new rooftops), so match by make+name across every
    // state-scoped entry rather than a single map.get() — see
    // stateScopedKey()'s comment above for why the map key itself is now
    // state-scoped.
    for (const prev of [...map.values()]) {
      if (overlayKey(prev.make, prev.name) !== wantKey) continue;
      remember(map, { ...prev, domain: row.domain }, 'curated-overlay');
    }
  }
}

export function loadLocatorDealerMap({ cwd = process.cwd(), state = null } = {}) {
  const crawlerRoot = crawlerRootFrom(cwd);
  const repoRoot = repoRootFrom(cwd);
  const map = new Map();
  loadDumpFiles(crawlerRoot, map);
  loadInRepoLocators(crawlerRoot, map);
  loadListingVerified(repoRoot, map, state);
  applyCuratedOverlay(map);
  return map;
}

export function locatorRowsForState(state, { cwd = process.cwd() } = {}) {
  const wanted = String(state || '').toUpperCase();
  return [...loadLocatorDealerMap({ cwd, state: wanted }).values()]
    .filter((row) => row.state === wanted);
}

export { CURATED_OVERLAY, SOURCE_RANK };
