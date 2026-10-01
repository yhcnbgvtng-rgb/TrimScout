// Lite nightly crawl — planning logic, Phase 0 (SHADOW ONLY).
//
// Today every sitemap URL costs one full VDP fetch (standalone.js extractOne), and that fetch is the
// only source of VIN, price, mileage and options. The eventual lite mode skips that fetch for VINs we
// already know well, carrying the prior snapshot record forward instead. Phase 0 changes no crawl
// behavior at all: in 'shadow' mode it only computes, per dealer, which URLs WOULD be skipped and then
// checks that prediction against what the normal full fetch actually returned — so the Phase 1
// go/no-go is decided on real numbers (how many fetches lite saves, and how often the URL -> VIN
// index built from yesterday's snapshot is wrong).
//
// Hard constraint any future 'on' mode must respect: inventory_merge.js marks an in-scope VIN that is
// missing from currentInventory as SOLD (and the deals-box sweep then removes it). A skipped VDP must
// therefore be carried forward with carryForwardRecord(), never just dropped.
//
// Pure except createLiteShadowSession's injected `log` — no I/O, no network, no DB.

export const LITE_PLATFORMS = Object.freeze(['ddc', 'viewdetails', 'flat_vin']);

// Anything other than 'shadow' (unset, 'off', typos — and 'on', which is not implemented yet) is 'off'.
export function liteModeFromEnv(env = {}) {
  return String(env.CRAWLER_LITE_NIGHTLY || '').trim().toLowerCase() === 'shadow' ? 'shadow' : 'off';
}

export function litePlatformsFromEnv(env = {}) {
  const raw = env.CRAWLER_LITE_PLATFORMS;
  if (raw === undefined || String(raw).trim() === '') return [...LITE_PLATFORMS];
  return String(raw).split(',').map((s) => s.trim().toLowerCase()).filter((p) => LITE_PLATFORMS.includes(p));
}

// URL shape -> dealer platform. Same shapes vdpUrlFilter.js recognizes as vehicle pages.
export function classifyPlatform(url) {
  const u = String(url || '');
  if (/-[a-f0-9]{32}\.htm/i.test(u)) return 'ddc';
  if (/\/viewdetails\//i.test(u)) return 'viewdetails';
  if (/-[A-HJ-NPR-Z0-9]{17}(?:[/?#]|$)/i.test(u)) return 'flat_vin';
  return 'other';
}

// Match key for "is tonight's sitemap URL the same page we fetched before": ignores protocol, "www.",
// case, a trailing slash and the #fragment. Keeps the query string — some platforms put the vehicle's
// identity there, and dropping it could make different vehicles collide on one key.
export function normalizeVdpUrl(url) {
  const raw = String(url || '').trim();
  if (!raw) return '';
  try {
    const u = new URL(raw);
    const host = u.hostname.toLowerCase().replace(/^www\./, '');
    const pathname = u.pathname.replace(/\/+$/, '');
    return `${host}${pathname}${u.search}`.toLowerCase();
  } catch {
    return raw.replace(/#.*$/, '').replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/\/+$/, '').toLowerCase();
  }
}

// normalized URL -> VIN, ACTIVE snapshot records only. A URL claimed by two different VINs is dropped:
// a mapping we can't trust must send that URL down the full-fetch path, never the lite one.
export function buildUrlIndex(snapshot = {}) {
  const index = new Map();
  const ambiguous = new Set();
  for (const [vin, rec] of Object.entries(snapshot || {})) {
    if (!rec || rec.status !== 'ACTIVE' || !rec.url) continue;
    const key = normalizeVdpUrl(rec.url);
    if (!key || ambiguous.has(key)) continue;
    const existing = index.get(key);
    if (existing && existing !== vin) {
      index.delete(key);
      ambiguous.add(key);
      continue;
    }
    index.set(key, vin);
  }
  return index;
}

const nonEmptyList = (v) => Array.isArray(v) && v.length > 0;

// Phase 0 definition of "already has real options": the local snapshot record carries a non-empty
// options list. TODO(Phase 1): confirm against the deals box's options-status check (a VIN counts only
// if it has at least one dealer_inventory_options row) — stored options_json alone can still hold junk
// whose facet rows were purged. Not called in Phase 0: shadow mode makes no deals-box requests.
export function knownGoodVinsFromSnapshot(snapshot = {}) {
  const known = new Set();
  for (const [vin, rec] of Object.entries(snapshot || {})) {
    if (rec && rec.status === 'ACTIVE' && (nonEmptyList(rec.dealerListedOptions) || nonEmptyList(rec.factoryOptions))) {
      known.add(vin);
    }
  }
  return known;
}

/**
 * Splits one dealer's URLs into what the lite pass would full-fetch vs skip. A URL is lite only if it
 * maps to a snapshot VIN, that VIN is known-good, and its platform is allowed; everything else is full.
 * Also returns `matched` (URLs that map to any snapshot VIN) and per-platform counts for reporting.
 */
export function planDealer({ urls = [], urlIndex = new Map(), snapshot = {}, knownGoodVins = new Set(), platforms = LITE_PLATFORMS } = {}) {
  const allowed = new Set(platforms);
  const full = [];
  const lite = [];
  const byPlatform = {};
  let matched = 0;
  for (const url of urls) {
    const platform = classifyPlatform(url);
    const bucket = (byPlatform[platform] ||= { urls: 0, matched: 0, liteEligible: 0 });
    bucket.urls++;
    const vin = urlIndex.get(normalizeVdpUrl(url));
    if (vin && snapshot[vin]) {
      matched++;
      bucket.matched++;
      if (knownGoodVins.has(vin) && allowed.has(platform)) {
        lite.push({ url, vin, platform });
        bucket.liteEligible++;
        continue;
      }
    }
    full.push(url);
  }
  return { full, lite, matched, byPlatform };
}

const finiteNumber = (v) => typeof v === 'number' && Number.isFinite(v);

// What a lite-skipped VIN is recorded as tonight: yesterday's record, seen today, with price/mileage
// from a cheap listing source when it provides a real number. Options fields are copied through
// untouched — a lite pass must never rewrite them. Does not mutate `prev`.
export function carryForwardRecord(prev, listing, todayDate) {
  return {
    ...prev,
    lastSeen: todayDate,
    liteCarried: true,
    price: finiteNumber(listing?.price) ? listing.price : prev.price,
    mileage: finiteNumber(listing?.mileage) ? listing.mileage : prev.mileage,
  };
}

const COUNTERS = ['urlsTotal', 'matched', 'liteEligible', 'liteEligibleProduced', 'indexMismatches', 'vehiclesExtracted'];
const PLATFORM_COUNTERS = ['urls', 'matched', 'liteEligible', 'liteEligibleProduced', 'indexMismatches'];

export function emptyLiteShadowStats() {
  const stats = Object.fromEntries(COUNTERS.map((k) => [k, 0]));
  stats.byPlatform = {};
  return stats;
}

// Sums two stats blocks (either may be null/undefined). Used across shards of one brand
// (run-daily-crawl.mjs) and across brands in the box report.
export function addLiteShadowStats(a, b) {
  if (!a && !b) return null;
  const out = emptyLiteShadowStats();
  for (const src of [a, b]) {
    if (!src) continue;
    for (const k of COUNTERS) out[k] += Number(src[k]) || 0;
    for (const [platform, counts] of Object.entries(src.byPlatform || {})) {
      const bucket = (out.byPlatform[platform] ||= Object.fromEntries(PLATFORM_COUNTERS.map((k) => [k, 0])));
      for (const k of PLATFORM_COUNTERS) bucket[k] += Number(counts?.[k]) || 0;
    }
  }
  return out;
}

const NOOP_SESSION = Object.freeze({
  mode: 'off',
  beginDealer() {},
  recordExtracted() {},
  endDealer() {},
  stats() { return null; },
});

/**
 * Per-run shadow bookkeeping. 'off' returns a frozen no-op (no logs, no state, stats() === null), so
 * the call sites in standalone.js are behavior-neutral when the flag is unset. In 'shadow':
 *   beginDealer(name, urls)    plan the dealer and log the prediction (never modifies `urls`)
 *   recordExtracted(url, vin)  called for every vehicle the normal full fetch kept
 *   endDealer()                log how the prediction held up and fold it into the run totals
 *   stats()                    run totals for the brand's daily-changes record / box report
 */
export function createLiteShadowSession({ mode = 'off', platforms = LITE_PLATFORMS, snapshot = {}, log = () => {} } = {}) {
  if (mode !== 'shadow') return NOOP_SESSION;
  const urlIndex = buildUrlIndex(snapshot);
  const knownGoodVins = knownGoodVinsFromSnapshot(snapshot);
  let totals = emptyLiteShadowStats();
  let current = null;

  return {
    mode: 'shadow',
    beginDealer(dealerName, urls) {
      if (current) this.endDealer();
      const plan = planDealer({ urls, urlIndex, snapshot, knownGoodVins, platforms });
      const liteByUrl = new Map(plan.lite.map((l) => [l.url, l]));
      current = { dealerName, plan, liteByUrl, produced: new Set(), mismatched: new Set(), vehiclesExtracted: 0 };
      const compact = Object.fromEntries(Object.entries(plan.byPlatform).map(([p, c]) => [p, { urls: c.urls, lite: c.liteEligible }]));
      log(`[lite-shadow] ${dealerName} urls=${urls.length} matched=${plan.matched} liteEligible=${plan.lite.length} byPlatform=${JSON.stringify(compact)}`);
    },
    recordExtracted(url, vin) {
      if (!current) return;
      current.vehiclesExtracted++;
      const predicted = current.liteByUrl.get(url);
      if (!predicted) return;
      current.produced.add(url);
      if (vin !== predicted.vin) current.mismatched.add(url);
    },
    endDealer() {
      if (!current) return;
      const { dealerName, plan, liteByUrl, produced, mismatched, vehiclesExtracted } = current;
      const dealerStats = emptyLiteShadowStats();
      dealerStats.urlsTotal = plan.full.length + plan.lite.length;
      dealerStats.matched = plan.matched;
      dealerStats.liteEligible = plan.lite.length;
      dealerStats.liteEligibleProduced = produced.size;
      dealerStats.indexMismatches = mismatched.size;
      dealerStats.vehiclesExtracted = vehiclesExtracted;
      for (const [platform, c] of Object.entries(plan.byPlatform)) {
        dealerStats.byPlatform[platform] = { urls: c.urls, matched: c.matched, liteEligible: c.liteEligible, liteEligibleProduced: 0, indexMismatches: 0 };
      }
      for (const url of produced) dealerStats.byPlatform[liteByUrl.get(url).platform].liteEligibleProduced++;
      for (const url of mismatched) dealerStats.byPlatform[liteByUrl.get(url).platform].indexMismatches++;
      log(`[lite-shadow] ${dealerName} liteEligibleProduced=${produced.size}/${plan.lite.length} indexMismatches=${mismatched.size} vehiclesExtracted=${vehiclesExtracted}`);
      totals = addLiteShadowStats(totals, dealerStats);
      current = null;
    },
    stats() {
      return addLiteShadowStats(totals, null);
    },
  };
}
