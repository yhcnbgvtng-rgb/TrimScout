// NJ-only dealer policy for the Lightsail inventory crawler.
//
// One brand at a time, authorized single-franchise rooftops only.
// Megadealer multi-franchise groups and used superstores are skipped.
// Detecting bot protection is required; defeating it is forbidden — this
// module only decides *who* is in scope, not how a site is fetched.

import { locatorRowsForState } from './oem_locator.js';

export const NJ_BRANDS_IN_CORE = [
  'Toyota',
  'Lexus',
  'Kia',
  'Honda',
  'Acura',
  'Nissan',
  'Infiniti',
  'Subaru',
  'Mazda',
  'Volkswagen',
  'Audi',
  'BMW',
  'Mercedes-Benz',
  'Volvo',
  'Porsche',
  'Mini',
  'Mitsubishi',
  // Added 2026-09-20 after a real 15-dealer pilot across 15 states came
  // back with 0 crashes, 0 errors, 0 zero-extraction/sitemap-discovery
  // misses — 2,959 real vehicles, clean. Genesis (Hyundai's sister brand)
  // is deliberately NOT added alongside it: its own pilot showed a
  // sitemap-discovery miss on 4 of 15 dealers (26.7%), a real gap worth
  // fixing before it goes into the nightly rotation, not a one-off.
  'Hyundai',
];

// Box 3/box 4's brand set (CRAWLER_BRAND_SET=expansion — see below):
// domestic Ford/GM/Stellantis brands, added 2026-09-20 after sizing the
// real dealer rosters (Ford 2,083 / Chevrolet 2,039 / GMC 1,639 / Buick 744
// / Cadillac 565 / Lincoln 402 / Stellantis 2,337, ~9,700 raw rooftops).
// 'Stellantis' covers Chrysler/Dodge/Jeep/Ram/Fiat as ONE crawl config —
// see brands.js's Stellantis entry and brand_match.js. Genesis stays out
// here too (same unresolved sitemap-discovery gap as the core set).
export const NJ_BRANDS_IN_EXPANSION = [
  'Ford',
  'Lincoln',
  'Chevrolet',
  'GMC',
  'Buick',
  'Cadillac',
  'Stellantis',
];

export const NJ_BRANDS_OUT_CORE = [
  'Ford',
  'Lincoln',
  'Chevy',
  'Chevrolet',
  'GMC',
  'Buick',
  'Cadillac',
  'Chrysler',
  'Dodge',
  'Jeep',
  'Ram',
  'Genesis',
  'Tesla',
  'Rivian',
  'Lucid',
  'Hummer',
];

// Direct-to-consumer brands with no traditional franchise dealer network
// (never in scope for either brand set), plus Genesis's own unresolved gap.
export const NJ_BRANDS_OUT_EXPANSION = [
  'Genesis',
  'Tesla',
  'Rivian',
  'Lucid',
  'Hummer',
];

// Which brand set THIS process runs — 'core' (default; box 1/box 2's
// original 18 brands, unchanged) or 'expansion' (box 3/box 4's new
// domestic brands). Read once at module load, same as CRAWLER_STATE/
// CRAWLER_BRAND in standalone.js: every real invocation (write-<state>-
// dealer-files.mjs, run-daily-crawl.mjs, standalone.js itself) is a fresh
// process with this env var already set before it starts, so box 1/box 2
// — which never set it — get exactly NJ_BRANDS_IN_CORE/OUT_CORE, byte-for-
// byte what NJ_BRANDS_IN/OUT used to be before this existed.
const IS_EXPANSION = process.env.CRAWLER_BRAND_SET === 'expansion';
export const NJ_BRANDS_IN = IS_EXPANSION ? NJ_BRANDS_IN_EXPANSION : NJ_BRANDS_IN_CORE;
export const NJ_BRANDS_OUT = IS_EXPANSION ? NJ_BRANDS_OUT_EXPANSION : NJ_BRANDS_OUT_CORE;

const BRAND_ALIASES = {
  mercedes: 'Mercedes-Benz',
  'mercedes-benz': 'Mercedes-Benz',
  vw: 'Volkswagen',
  volkswagen: 'Volkswagen',
  mini: 'Mini',
  chevy: 'Chevrolet',
  chevrolet: 'Chevrolet',
  // Any of Stellantis's nameplates canonicalizes to the combined brand —
  // see brands.js's Stellantis entry and NJ_BRANDS_IN_EXPANSION above.
  jeep: 'Stellantis',
  ram: 'Stellantis',
  dodge: 'Stellantis',
  chrysler: 'Stellantis',
  fiat: 'Stellantis',
};

const IN_SET = new Set(NJ_BRANDS_IN.map((b) => b.toLowerCase()));
const OUT_SET = new Set(NJ_BRANDS_OUT.map((b) => b.toLowerCase()));

// Used superstores + publicly multi-franchise megadealer groups. A rooftop
// whose *name* is a single authorized franchise (e.g. "Paul Miller Porsche")
// is kept even when the parent company also owns other desks.
const MEGA_OR_SUPERSTORE_RE =
  /\b(autonation|carmax|carvana|drivetime|vroom|shift motors|lithia|penske|group 1 automotive|sonic automotive|asbury|open road|used superstore|auto superstore|car superstore|megadealer)\b/i;

// Same physical lot selling two manufacturer lines — not a single-franchise rooftop.
const MULTI_FRANCHISE_RE =
  /(chevrolet\s*\/?\s*gmc|gmc\s*\/?\s*buick|ford\s+lincoln|lincoln\s+ford|chrysler\s+dodge|dodge\s+jeep|jeep\s+ram|honda\s+kia|kia\s+hyundai|hyundai\s+genesis)/i;

export function canonicalBrandName(name) {
  if (!name) return null;
  const trimmed = String(name).trim();
  const aliased = BRAND_ALIASES[trimmed.toLowerCase()];
  if (aliased) return aliased;
  const hit = NJ_BRANDS_IN.find((b) => b.toLowerCase() === trimmed.toLowerCase())
    || NJ_BRANDS_OUT.find((b) => b.toLowerCase() === trimmed.toLowerCase());
  return hit || trimmed;
}

export function isNjBrandIn(name) {
  const canon = canonicalBrandName(name);
  return Boolean(canon && IN_SET.has(canon.toLowerCase()));
}

export function isNjBrandOut(name) {
  const canon = canonicalBrandName(name);
  return Boolean(canon && OUT_SET.has(canon.toLowerCase()));
}

export function isMegadealerOrSuperstore(dealer) {
  const hay = `${dealer?.name || ''} ${dealer?.domain || ''} ${dealer?.id || ''}`;
  if (MEGA_OR_SUPERSTORE_RE.test(hay)) return true;
  // Combo/multi-franchise dealers are allowed for the expansion brand set:
  // Ford/Lincoln and GM's domestic brands are structurally built around
  // co-located combo stores (real-world estimate: 60-85% of Buick/GMC/
  // Cadillac/Lincoln dealers) — excluding them by name pattern the way the
  // core set does would gut those brands' coverage before crawling a
  // single dealer. The time/volume risk a bigger combo lot poses is bounded
  // elsewhere instead (DEALER_TIMEOUT_MS, the per-dealer vehicle cap, and
  // parallelized NHTSA enrichment) — see standalone.js/enricher.js. Core
  // brands keep the original combo exclusion unchanged.
  if (IS_EXPANSION) return false;
  return MULTI_FRANCHISE_RE.test(hay);
}

export function isNjDealer(dealer) {
  return String(dealer?.state || '').trim().toUpperCase() === 'NJ';
}

function publicOrigin(host) {
  const parts = String(host || '').split('.').filter(Boolean);
  // jackdaniels.porsche.com (and similar retailer platforms) already is the
  // public host — prefixing www. breaks the sitemap.
  if (parts.length > 2) return `https://${host}`;
  return `https://www.${host}`;
}

export function buildDealerRecord({ id, name, city, domain, make, state = 'NJ', lat = null, lng = null, sitemapUrl, inventorySitemapUrl, fallbackUrl }) {
  const host = String(domain || '')
    .replace(/^https?:\/\//i, '')
    .replace(/\/.*$/, '')
    .replace(/^www\./i, '');
  const origin = publicOrigin(host);
  return {
    id: id || slugify(`${make || 'dealer'}-${name || host}`),
    name,
    city: city || null,
    state: String(state || 'NJ').toUpperCase(),
    make: canonicalBrandName(make) || make,
    domain: host,
    sitemapUrl: sitemapUrl || `${origin}/sitemap.xml`,
    inventorySitemapUrl: inventorySitemapUrl || `${origin}/sitemap-inventory.xml`,
    fallbackUrl: fallbackUrl || `https://${host}/`,
    lat,
    lng,
  };
}

export function dealerHomeUrl(dealer) {
  const host = String(dealer.domain || '').replace(/^www\./i, '');
  return host ? `https://${host}/` : null;
}

export function dealerProbeUrls(dealer) {
  const urls = [
    dealer.sitemapUrl,
    dealer.inventorySitemapUrl,
    dealerHomeUrl(dealer),
    dealer.fallbackUrl,
  ].filter(Boolean);
  return [...new Set(urls)];
}

function slugify(s) {
  return (
    (s || 'dealer')
      .toString()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'dealer'
  );
}

export function acceptNjDealer(dealer, { brand = null } = {}) {
  if (!dealer || !isNjDealer(dealer)) return false;
  const make = canonicalBrandName(dealer.make || brand);
  if (!make || !isNjBrandIn(make)) return false;
  if (isNjBrandOut(make)) return false;
  if (isMegadealerOrSuperstore(dealer)) return false;
  if (brand && canonicalBrandName(brand) !== make) return false;
  return true;
}

// Loads NJ-only, in-brand, single-franchise rooftops from OEM locator
// dumps / in-repo official directories / listing-verified hosts.
// Does not read the old invented brandofcity seed.
export function loadNjDealers({ cwd = process.cwd(), brand = null } = {}) {
  if (brand && isNjBrandOut(brand)) return [];
  const out = [];
  const seenName = new Set();
  const seenHost = new Set();
  for (const raw of locatorRowsForState('NJ', { cwd })) {
    const make = canonicalBrandName(raw.make);
    const dealer = {
      ...raw,
      make,
      state: 'NJ',
    };
    if (!acceptNjDealer(dealer, { brand })) continue;
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
