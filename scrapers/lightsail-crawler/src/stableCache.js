// A stale-while-revalidate cache, persisted to disk, for the buyer /search dropdown payloads
// (state/make/model/trim counts, option catalog).
//
// Why these can't use deals_api_server.js's invCached: that cache is cleared by invInvalidate() on
// EVERY bulk upsert and every sweep that removes rows, and a concurrent invalidation also discards a
// result that was mid-computation. While crawl boxes push continuously (hours, every night) the
// whole-table GROUP BYs behind these dropdowns therefore can never be cached — and confirmed live
// 2026-10-01 they cannot finish inside the 20s statement cap on a box that is I/O-bound (60-78%
// iowait, 128MB buffer pool) from those same writes. Result: Make dropdown stuck on "Loading…".
//
// Hit counts in a dropdown do not need to be write-fresh (the vehicle LIST is always live), so:
//   - fresh entry (< ttlMs)  -> returned
//   - expired entry          -> returned IMMEDIATELY; one background refresh runs (single flight)
//   - outdated entry         -> (opt-in `isOutdated`, e.g. built from an older facet build than the current one) treated as expired even
//                               inside the ttl, and the caller gets a short chance (`outdatedWaitMs`) to receive the refreshed value;
//                               if the refresh is slower or fails, the old copy is served exactly as for an expired entry
//   - no entry (cold)        -> the caller waits for the compute and sees its error
//   - every successful compute is persisted, so a restart does not lose it
// Pure of the server: the compute function and clock are injected, so it is unit-testable.

import fs from "node:fs";

/**
 * True when a cached payload carries a `countsAsOf` stamp and it is NOT the current build stamp. Payloads without a stamp (the other users of this
 * cache) or an unknown current build are never outdated. Compares instants, not spellings (a Date in memory, an ISO string after a restart).
 */
export function builtForOtherBuild(value, currentBuiltAt) {
  if (!value || value.countsAsOf == null || currentBuiltAt == null) return false;
  const a = new Date(value.countsAsOf).getTime(), b = new Date(currentBuiltAt).getTime();
  if (Number.isNaN(a) || Number.isNaN(b)) return false;
  return a !== b;
}

export function createStableCache({ ttlMs, filePath = null, now = Date.now, maxEntries = 500, log = console, runBackground = null, isOutdated = null, outdatedWaitMs = 3000 }) {
  const entries = new Map(); // key -> { at, value }
  const inFlight = new Map(); // key -> Promise
  let writeTimer = null;

  if (filePath) {
    try {
      const raw = JSON.parse(fs.readFileSync(filePath, "utf8"));
      for (const [k, e] of Object.entries(raw)) if (e && typeof e.at === "number") entries.set(k, { at: e.at, value: e.value });
      log.log(`stable cache: loaded ${entries.size} entries from ${filePath}`);
    } catch { /* first boot, or unreadable file: start empty */ }
  }

  function persistSoon() {
    if (!filePath || writeTimer) return;
    writeTimer = setTimeout(() => {
      writeTimer = null;
      try {
        const tmp = `${filePath}.tmp`;
        fs.writeFileSync(tmp, JSON.stringify(Object.fromEntries(entries)));
        fs.renameSync(tmp, filePath);
      } catch (err) { log.error(`stable cache: persist failed: ${err.message}`); }
    }, 2000);
    writeTimer.unref?.();
  }

  // background = an expired entry is being recomputed while the old copy is served (nobody waits on it); a cold key is not.
  function refresh(key, compute, background = false) {
    const existing = inFlight.get(key);
    if (existing) return existing;
    const p = (async () => {
      try {
        const value = await (background && runBackground ? runBackground(compute) : compute());
        entries.set(key, { at: now(), value });
        if (entries.size > maxEntries) entries.delete(entries.keys().next().value); // oldest inserted
        persistSoon();
        return value;
      } finally { inFlight.delete(key); }
    })();
    inFlight.set(key, p);
    return p;
  }

  return {
    async get(key, compute) {
      const e = entries.get(key);
      let outdated = false;
      if (e && isOutdated) { try { outdated = Boolean(isOutdated(e.value)); } catch { outdated = false; } }
      if (e && !outdated && now() - e.at < ttlMs) return e.value;
      if (e) {
        const p = refresh(key, compute, true);
        p.catch((err) => log.error(`stable cache: background refresh of ${key} failed, still serving stale: ${err.message}`));
        if (outdated) {
          // Built from an older facet build: let the refresh try to land first so this caller sees the new build; never wait longer than outdatedWaitMs.
          let timer;
          const fresh = await Promise.race([p.then((value) => ({ value }), () => null), new Promise((r) => { timer = setTimeout(() => r(null), outdatedWaitMs); })]);
          clearTimeout(timer);
          if (fresh) return fresh.value;
        }
        return e.value;
      }
      return refresh(key, compute);
    },
    /** For tests/ops: what is cached and how old. */
    stats: () => ({ entries: entries.size, inFlight: inFlight.size }),
    peek: (key) => entries.get(key) || null,
  };
}
