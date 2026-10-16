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
