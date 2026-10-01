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
//   - no entry (cold)        -> the caller waits for the compute and sees its error
//   - every successful compute is persisted, so a restart does not lose it
// Pure of the server: the compute function and clock are injected, so it is unit-testable.

import fs from "node:fs";

export function createStableCache({ ttlMs, filePath = null, now = Date.now, maxEntries = 500, log = console }) {
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

  function refresh(key, compute) {
    const existing = inFlight.get(key);
    if (existing) return existing;
    const p = (async () => {
      try {
        const value = await compute();
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
      if (e && now() - e.at < ttlMs) return e.value;
      if (e) {
        refresh(key, compute).catch((err) => log.error(`stable cache: background refresh of ${key} failed, still serving stale: ${err.message}`));
        return e.value;
      }
      return refresh(key, compute);
    },
    /** For tests/ops: what is cached and how old. */
    stats: () => ({ entries: entries.size, inFlight: inFlight.size }),
    peek: (key) => entries.get(key) || null,
  };
}
