// Sitemap discovery bookkeeping for standalone.js, kept pure so it is unit-testable (standalone.js is a self-running script).
//
// Before this module a failed sitemap fetch (timeout, 429, 5xx, socket error) and a sitemap that genuinely listed no vehicles both ended in
// a bare `catch { return [] }` and the same "No inventory URLs detected" line (found 2026-10-16: stores such as Kia of Cape Coral logged it on
// consecutive nights although the same sitemap fetched fine hours later). Now every candidate sitemap leaves an attempt record, and the
// outcome of discovery is one of:
//   ok      at least one likely VDP URL was found
//   empty   every candidate answered (2xx with no vehicle URLs, or 404/410 "no such sitemap") - nothing is wrong, the store lists nothing
//   failed  nothing found AND at least one candidate errored or was refused/limited (timeout, reset, 403, 408, 429, 5xx) - not evidence of zero stock
// A `failed` store is retried once at the end of the run, apex host first. Nothing here bypasses a block: a refusal is recorded and the
// retry is the same plain request.

import { isLikelyVdpUrl } from './vdpUrlFilter.js';

export const ZERO_VDP_ALERT_MIN_PREVIOUS = 100;

const MISSING_STATUSES = new Set([404, 410]);

/** @param {{status?: number|null, error?: string|null, vdp?: number}} a */
export function classifyAttempt(a) {
  if (a.error) return "failed";
  const s = a.status ?? null;
  if (s === null) return "failed";
  if (MISSING_STATUSES.has(s)) return "empty";
  if (s >= 200 && s < 300) return (a.vdp ?? 0) > 0 ? "ok" : "empty";
  return "failed"; // 3xx left unfollowed, 403, 408, 429, 5xx, anything else
}

/** One log line per candidate sitemap. */
export function describeAttempt(a) {
  const kind = classifyAttempt(a);
  const what = a.error ? `ERROR ${a.error}` : `HTTP ${a.status}`;
  const counts = a.error || (a.status != null && (a.status < 200 || a.status >= 300)) ? "" : `, ${a.locs ?? 0} <loc>, ${a.vdp ?? 0} VDP`;
  return `   ↳ sitemap ${a.url} → ${what}${counts} [${kind}]`;
}

/** @returns {{ outcome: "ok"|"empty"|"failed", failures: number, note: string }} */
export function summarizeDiscovery(attempts, urlCount) {
  if (urlCount > 0) return { outcome: "ok", failures: attempts.filter((a) => classifyAttempt(a) === "failed").length, note: "" };
  const failed = attempts.filter((a) => classifyAttempt(a) === "failed");
  if (failed.length) {
    const why = [...new Set(failed.map((a) => (a.error ? a.error : `HTTP ${a.status}`)))].join(", ");
    return { outcome: "failed", failures: failed.length, note: `discovery FAILED (${failed.length}/${attempts.length} candidates: ${why})` };
  }
  return { outcome: "empty", failures: 0, note: attempts.length ? "sitemaps answered but listed no vehicle URLs" : "no candidate sitemap URLs" };
}

const stripWww = (host) => String(host || "").replace(/^www\./i, "");
const hostOf = (u) => { try { return new URL(u).hostname; } catch { return ""; } };

/**
 * The ordered candidate list the crawl has always used, de-duplicated. `apexFirst` (the retry pass) puts the apex host's sitemaps ahead of
 * the www ones: a dealer record often names www.<domain>, which for some platforms serves a small stub while the apex serves the real sitemap.
 */
export function candidateSitemapUrls(dealer, { apexFirst = false } = {}) {
  const host = dealer.domain || hostOf(dealer.sitemapUrl);
  const base = [
    dealer.sitemapUrl,
    dealer.inventorySitemapUrl,
    host ? `https://${host}/sitemap-inventory.xml` : null,
    host ? `https://${host}/sitemap.xml` : null,
    dealer.fallbackUrl,
  ].filter(Boolean);
  let list = [...new Set(base)];
  if (apexFirst) {
    const apex = stripWww(host);
    const extra = apex ? [`https://${apex}/sitemap.xml`, `https://${apex}/sitemap-inventory.xml`] : [];
    const isApex = (u) => stripWww(hostOf(u)) === apex && !/^www\./i.test(hostOf(u));
    list = [...new Set([...extra, ...list.filter(isApex), ...list])];
  }
  return list;
}

/**
 * `Sitemap:` lines of a robots.txt that point at the dealer's own site (same host ignoring a leading www) and were not already tried. Found 2026-10-18:
 * persistent "answered but listed no vehicle URLs" stores (Jeff Wyler Nissan Louisville, Jeff Wyler Honda of Colerain, West Herr Subaru, Kia of Cape Coral) answer
 * 200 with 0 <loc> at /sitemap.xml and /sitemap-inventory.xml on both hosts, while their robots.txt names a sitemap on the apex host. Third-party hosts are
 * ignored (a sitemap on another site is not this store's inventory), http/https only, at most `max` URLs.
 * @param {string} robotsText
 * @param {string} dealerHost  host the crawl uses for this dealer (www or apex)
 * @param {string[]} [alreadyTried]
 */
export function robotsSitemapUrls(robotsText, dealerHost, alreadyTried = [], max = 5) {
  const site = stripWww(String(dealerHost || "").toLowerCase());
  if (!site) return [];
  const tried = new Set(alreadyTried);
  const out = [];
  for (const m of String(robotsText || "").matchAll(/^\s*sitemap\s*:\s*(\S+)/gim)) {
    let u;
    try { u = new URL(m[1]); } catch { continue; }
    if (u.protocol !== "https:" && u.protocol !== "http:") continue;
    if (stripWww(u.hostname.toLowerCase()) !== site) continue;
    const href = u.href;
    if (tried.has(href) || out.includes(href)) continue;
    out.push(href);
    if (out.length >= max) break;
  }
  return out;
}

// Sitemap XML escapes reserved characters inside <loc> (a literal "+" becomes "&#x2B;"); undo that so the URL is fetchable.
export function decodeXmlEntities(str) {
  return str
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

// Some platforms (Audi's retailer sitemap template) wrap every <loc> value in CDATA; match either shape (group 1 or 2 holds the URL).
const LOC_RE = /<loc>\s*(?:<!\[CDATA\[([^\]]+)\]\]>|([^<]+))\s*<\/loc>/gi;
export const locMatches = (xml) => [...xml.matchAll(LOC_RE)].map((m) => decodeXmlEntities((m[1] ?? m[2] ?? '').trim())).filter(Boolean);

export const MAX_CHILD_SITEMAPS = 8;

/**
 * Which child sitemaps of a sitemap index to open, in order. Found 2026-10-23 while chasing "robots.txt declares N sitemap(s)" lines that never led to an
 * "Extracted" line: the old preference regex ended in `|sitemap`, which every child of a `sitemap_index.xml` matches (post-sitemap.xml, page-sitemap.xml ...),
 * (and the brand word matched the dealer's own host name, e.g. kiaofcapecoral.com, which is in every child URL) so nothing was ever preferred and `slice(0, 8)` kept the FIRST eight children in file order. A declared index listing the vehicle sitemap ninth or later
 * (WordPress-style indexes list posts/pages/categories first, alphabetical by type) never had that child fetched at all. Inventory-looking children now go
 * first; when none look like inventory the first `max` children are tried in file order, as before.
 */
export function selectChildSitemaps(children, brandWord, max = MAX_CHILD_SITEMAPS) {
  const word = String(brandWord || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const re = new RegExp(`vehicle|inventory|cars|vdp|listing|${word ? `${word}|` : ''}(?:^|[/_-])(?:new|used|cpo|certified)(?:[/_.-]|$)`, 'i');
  // Match the path only: dealer hosts are usually named for the brand (kiaofcapecoral.com, jeffwylernissan.com), so testing the whole URL made the brand word match every child.
  const pathOf = (u) => { try { const x = new URL(u); return `${x.pathname}${x.search}`; } catch { return u; } };
  const inventoryish = children.filter((u) => re.test(pathOf(u)));
  return (inventoryish.length > 0 ? inventoryish : children).slice(0, max);
}

/**
 * Walks one sitemap (following indexes up to depth 2) and returns the likely-VDP URLs, pushing one attempt record per sitemap requested.
 * `fetchXml(url)` is the transport and returns `{ status, xml }`; it throws on network errors (`err.code`) or HTTP errors (`err.response.statusCode`).
 */
export async function walkSitemap(sitemapUrl, { brand, fetchXml, attempts = [], depth = 0 }) {
  if (depth > 2) return [];
  const attempt = { url: sitemapUrl, status: null, error: null, locs: 0, vdp: 0 };
  attempts.push(attempt);
  try {
    const { status, xml } = await fetchXml(sitemapUrl, attempt);
    attempt.status = status ?? null;
    const childSitemaps = [...String(xml).matchAll(/<sitemap>([\s\S]*?)<\/sitemap>/gi)].flatMap((m) => locMatches(m[1]));
    if (childSitemaps.length > 0) {
      const nested = [];
      for (const child of selectChildSitemaps(childSitemaps, brand.name)) {
        nested.push(...await walkSitemap(child, { brand, fetchXml, attempts, depth: depth + 1 }));
      }
      attempt.locs = childSitemaps.length;
      attempt.vdp = nested.length;
      return nested;
    }
    const allUrls = locMatches(String(xml));
    const vdpUrls = allUrls.filter((u) => isLikelyVdpUrl(u, brand));
    attempt.locs = allUrls.length;
    attempt.vdp = vdpUrls.length;
    return vdpUrls;
  } catch (err) {
    // got throws on 4xx/5xx (the HTTPError carries the response); anything else is a network/timeout error.
    if (err && err.response && err.response.statusCode) attempt.status = err.response.statusCode;
    else attempt.error = (err && (err.code || err.name)) || 'ERROR';
    return [];
  }
}

/**
 * The robots.txt step of discovery: parse the declared `Sitemap:` URLs, log them, and walk each until one yields vehicle URLs.
 * `fetchRobots()` returns the robots.txt text (throws on failure). `log` is console.log-compatible. Returns `{ urls, declared }`; attempts are appended to `attempts`.
 */
export async function discoverViaRobots({ dealerHost, brand, attempts, fetchRobots, fetchXml, log = () => {} }) {
  let text;
  try {
    text = await fetchRobots();
  } catch (err) {
    log(`   ↳ robots.txt ${err && err.response && err.response.statusCode ? `HTTP ${err.response.statusCode}` : `ERROR ${(err && (err.code || err.name)) || 'ERROR'}`} - not retried`);
    return { urls: [], declared: [] };
  }
  const declared = robotsSitemapUrls(text, dealerHost, attempts.map((a) => a.url));
  if (declared.length) log(`   ↳ robots.txt declares ${declared.length} sitemap(s) not tried yet`);
  for (const url of declared) {
    const found = await walkSitemap(url, { brand, fetchXml, attempts });
    if (found.length > 0) {
      log(`   ↳ robots.txt sitemap ${url} yielded ${found.length} vehicle URL(s)`);
      return { urls: found, declared };
    }
  }
  return { urls: [], declared };
}

/** Active vehicles per crawl-loop dealer key in a brand snapshot (the same key mergeInventorySnapshot scopes by). */
export function previousCountsByDealer(snapshot) {
  const counts = new Map();
  for (const rec of Object.values(snapshot || {})) {
    if (!rec || rec.status !== "ACTIVE") continue;
    const key = rec.configDealerName || rec.dealerName;
    if (key) counts.set(key, (counts.get(key) || 0) + 1);
  }
  return counts;
}

/** Stores that returned zero vehicles this run after a previous run with more than `minPrevious`. Sorted worst first. */
export function zeroVdpAlerts({ dealerStats, previousCounts, minPrevious = ZERO_VDP_ALERT_MIN_PREVIOUS, failedDealerNames = new Set(), skippedBotProtection = new Set() }) {
  const out = [];
  for (const [name, count] of Object.entries(dealerStats)) {
    const prev = previousCounts.get(name) || 0;
    if (count === 0 && prev > minPrevious) {
      out.push({ dealer: name, previous: prev, reason: skippedBotProtection.has(name) ? "bot-protection skip" : failedDealerNames.has(name) ? "failed" : "empty" });
    }
  }
  return out.sort((a, b) => b.previous - a.previous);
}

export const formatZeroVdpAlert = (a) => `🚨 ZERO-VDP ALERT: ${a.dealer} returned 0 vehicles (previous run ${a.previous}; ${a.reason})`;
