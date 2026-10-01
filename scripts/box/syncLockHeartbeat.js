// Client side of the sync-lock liveness protocol (see scrapers/lightsail-crawler/src/syncLock.js):
// while a sync holds the deals-API lock it renews it on a short interval, so a healthy-but-slow
// sync (5h+ on 2026-10-01) is never mistaken for a dead one and reclaimed by another box. Pure
// orchestration with injected timers/HTTP so it is unit-testable.
//
// On `renewed:false` the holder no longer owns the lock. If nobody else holds it (deals-api was
// restarted and forgot its in-memory state) it quietly re-acquires; if another box holds it (we
// were reclaimed) it logs LOST loudly — this module never aborts the sync (the caller decides), but
// it never pretends to still hold the lock either.
export function startSyncLockHeartbeat({ heartbeat, reacquire, log = console.log, setIntervalFn = setInterval, clearIntervalFn = clearInterval, intervalMs = 30_000 } = {}) {
  let lost = false;
  let inFlight = false;
  const tick = async () => {
    if (inFlight) return;
    inFlight = true;
    try {
      const r = await heartbeat();
      if (r && r.renewed) { lost = false; return; }
      if (r && r.heldBy == null) {
        const a = await reacquire();
        if (a && a.acquired) { log('[sync] sync lock was not held (deals-api restart?) — re-acquired it'); lost = false; return; }
        log(`[sync] LOCK LOST: could not re-acquire; now held by ${a && a.heldBy}`);
      } else {
        log(`[sync] LOCK LOST: reclaimed by ${r && r.heldBy} — another sync may be writing concurrently`);
      }
      lost = true;
    } catch (err) {
      // Transient network/server error: missing a beat or two is fine (stale limit is many beats).
      log(`[sync] lock heartbeat failed (will retry): ${err.message}`);
    } finally {
      inFlight = false;
    }
  };
  const timer = setIntervalFn(tick, intervalMs);
  if (timer && typeof timer.unref === 'function') timer.unref();
  return { stop: () => clearIntervalFn(timer), tick, isLost: () => lost };
}
