// Pure logic behind POST /api/ops/sync-lock/acquire|release — extracted from deals_api_server.js
// so it's unit-testable without starting a real server (same reason brand_match.js/
// vdpUrlFilter.js/optionSentenceFilter.js exist as their own modules: deals_api_server.js runs
// server.listen() unconditionally at import time).
//
// Re-added 2026-09-28: this route existed and worked (every sync log through 2026-09-27 shows it
// succeeding) but was missing entirely from deals_api_server.js and from the repo's own git
// history — confirmed live, `grep -c sync-lock` on both came back empty — so it must have only
// ever existed as a hand-patch directly on the box, never committed, and was lost when the box
// was redeployed/restarted during that day's Lightsail-fleet IP fix. Discovered live 2026-09-28
// when every one of that morning's catch-up syncs (box1's included, the exact run meant to land
// the off-brand-trade-in fix's first real data) crashed on `/api/ops/sync-lock/acquire -> 404`
// right before its write phase — after it had already spent real time reading and matching every
// vehicle, so the failure looked late and silent rather than fast and loud.
//
// A plain in-memory lock, exactly as scripts/box/inventory-sync.mjs's own comment already
// documented this route as being ("a single, unclustered PM2 process backs that server, so an
// in-memory lock there is enough — no DB table needed") — pm2's `deals-api` process really is
// unclustered (fork mode, 1 instance), confirmed live via `pm2 list`, so this doesn't need to
// survive a restart or be visible across processes the way crawl_claims (a real cross-box,
// cross-process queue) needs a table for.

// Longest real sync observed this session is well under an hour (2026-09-25's full nationwide
// run); a crashed sync that dies without calling release should never wedge every box out for
// longer than a generous multiple of that.
export const SYNC_LOCK_STALE_MS = 3 * 60 * 60 * 1000; // 3h

/**
 * @param {{ owner: string, acquiredAt: number } | null} lock current lock state
 * @param {string} owner requesting caller
 * @param {number} now current time (injected for deterministic tests)
 * @returns {{ nextLock: {owner: string, acquiredAt: number}, result: {acquired: true} | {acquired: false, heldBy: string, heldSinceMs: number} }}
 */
export function tryAcquireSyncLock(lock, owner, now) {
  // Self-heal a crashed holder that never released.
  const live = lock && now - lock.acquiredAt > SYNC_LOCK_STALE_MS ? null : lock;
  if (live && live.owner !== owner) {
    return { nextLock: live, result: { acquired: false, heldBy: live.owner, heldSinceMs: now - live.acquiredAt } };
  }
  // Same owner re-acquiring (a retry after a transient error) keeps the original acquiredAt
  // rather than resetting its own staleness clock.
  return { nextLock: { owner, acquiredAt: live ? live.acquiredAt : now }, result: { acquired: true } };
}

/**
 * Best-effort on the caller's side (inventory-sync.mjs swallows this call's own errors), so this
 * never needs to itself be strict: releasing a lock you don't hold, or one that already expired,
 * is just a no-op, not an error.
 * @returns {{ owner: string, acquiredAt: number } | null} the lock state after release
 */
export function releaseSyncLock(lock, owner) {
  return lock && lock.owner === owner ? null : lock;
}
