// Client side of sync backpressure. box2 samples its own iowait/load (crawlQueueServer.js makePressureSampler) and says
// ok:false once it is over the pause line, ok:true again only after it falls below the lower resume line. A sender about
// to do something heavy to box2 (a bulk upsert, a sweep, a cache push) calls wait() first and sleeps while box2 is hot.
//
// Two rules keep this from ever making things worse:
//   fail OPEN   — if the pressure endpoint is missing (older server), slow or erroring, wait() returns at once;
//   bounded     — after maxWaitMs it goes ahead anyway and says so, so a sampler stuck at "hot" cannot stall a sync forever.
import { request } from './crawlQueueClient.js';

export function makePressureWaiter({ fetchPressure = () => request({ method: 'GET', path: '/api/ops/sync-pressure', timeoutMs: 5000 }), sleep = (ms) => new Promise((r) => setTimeout(r, ms)), pollMs = Number(process.env.CRAWL_QUEUE_PRESSURE_POLL_MS) || 15_000, maxWaitMs = Number(process.env.CRAWL_QUEUE_PRESSURE_MAX_WAIT_MS) || 30 * 60_000, log = console.log, now = () => Date.now() } = {}) {
  let warnedMissing = false;
  return async function waitForPressure(what = 'request') {
    const t0 = now();
    let announced = false;
    for (;;) {
      let p = null;
      try { p = await fetchPressure(); } catch (e) {
        if (!warnedMissing) { warnedMissing = true; log(`[backpressure] pressure endpoint unavailable (${e.message}) — not throttling`); }
        return { waitedMs: now() - t0, failedOpen: true };
      }
      if (!p || p.ok !== false) return { waitedMs: now() - t0, pressure: p };
      const waited = now() - t0;
      if (waited >= maxWaitMs) { log(`[backpressure] box2 still busy (iowait ${p.iowaitPct}%, load ${p.load1}) after ${Math.round(waited / 1000)}s — going ahead with ${what}`); return { waitedMs: waited, gaveUp: true, pressure: p }; }
      if (!announced) { announced = true; log(`[backpressure] box2 busy (iowait ${p.iowaitPct}%, load ${p.load1}) — pausing ${what} until it settles`); }
      await sleep(pollMs);
    }
  };
}

/** Wraps a dealsApi(path, body, opts) so the heavy write calls wait for box2 first; everything else passes straight through. */
export function withBackpressure(dealsApi, waitForPressure, { heavy = /^\/api\/inventory\/(bulk|sweep|superseded|duplicate-vins)/ } = {}) {
  return async (path, body, opts) => {
    if (heavy.test(path)) await waitForPressure(path.split('/')[3] || 'write');
    return dealsApi(path, body, opts);
  };
}
