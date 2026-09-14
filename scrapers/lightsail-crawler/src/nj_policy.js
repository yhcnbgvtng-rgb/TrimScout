// NJ-only dealer policy for the Lightsail inventory crawler.
//
// One brand at a time, authorized single-franchise rooftops only.
// Megadealer multi-franchise groups and used superstores are skipped.
// Detecting bot protection is required; defeating it is forbidden — this
// module only decides *who* is in scope, not how a site is fetched.

import { locatorRowsForState } from './oem_locator.js';

export const NJ_BRANDS_IN = [
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
];

export const NJ_BRANDS_OUT = [
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
  'Hyundai',
  'Genesis',
  'Tesla',
  'Rivian',
  'Lucid',
  'Hummer',
];

const BRAND_ALIASES = {
  mercedes: 'Mercedes-Benz',
  'mercedes-benz': 'Mercedes-Benz',
  vw: 'Volkswagen',
  volkswagen: 'Volkswagen',
  mini: 'Mini',
  chevy: 'Chevrolet',
  chevrolet: 'Chevrolet',
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
  return MEGA_OR_SUPERSTORE_RE.test(hay) || MULTI_FRANCHISE_RE.test(hay);
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
