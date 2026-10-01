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

// LIVENESS, not elapsed time (changed 2026-10-01). The lock used to be reclaimed whenever it had
// been held longer than 3h, on the assumption that no healthy sync runs that long. Live that
// night: box1's sync legitimately ran 5h+ (slow upsert + a one-call-per-store sweep against a
// loaded deals box), the 3h clock expired while its process was still alive, box3 reclaimed the
// lock, and two syncs wrote at once — and box1 later died mid-sweep on a headers timeout.
//
// Now a holder proves it is alive by heartbeating (POST /api/ops/sync-lock/heartbeat, every
// SYNC_LOCK_HEARTBEAT_INTERVAL_MS from inventory-sync.mjs's syncLockHeartbeat.js). A lock is only
// reclaimed when its heartbeat has been silent for SYNC_LOCK_HEARTBEAT_STALE_MS — i.e. the holder
// missed many beats in a row, which a slow-but-alive sync never does — so a crash that skips
// release still frees the lock within minutes instead of hours.
//
// Mixed-version safety: a holder running the OLD client never heartbeats. Such a lock (heartbeatAt
// === null) keeps the old 3h wall-clock rule, so deploying the server before the box clients can't
// start stealing locks from not-yet-updated boxes after 10 minutes.
//
// Backstop: a holder that heartbeats forever but is wedged is reclaimed after SYNC_LOCK_MAX_HOLD_MS
// (a hung process whose timer still fires), with the reason logged.
export const SYNC_LOCK_STALE_MS = 3 * 60 * 60 * 1000; // legacy rule, holders that never heartbeat
export const SYNC_LOCK_HEARTBEAT_INTERVAL_MS = 30 * 1000;
export const SYNC_LOCK_HEARTBEAT_STALE_MS = 10 * 60 * 1000; // 20 missed beats
export const SYNC_LOCK_MAX_HOLD_MS = 24 * 60 * 60 * 1000;

/** Why (if at all) `lock` may be reclaimed at `now`; null = holder presumed alive. */
export function syncLockReclaimReason(lock, now) {
  if (!lock) return null;
  const held = now - lock.acquiredAt;
  if (held > SYNC_LOCK_MAX_HOLD_MS) return `held ${Math.round(held / 60000)}min, over the ${SYNC_LOCK_MAX_HOLD_MS / 3600000}h absolute cap`;
  if (lock.heartbeatAt == null) {
    return held > SYNC_LOCK_STALE_MS ? `no heartbeat support from holder and held ${Math.round(held / 60000)}min (legacy ${SYNC_LOCK_STALE_MS / 3600000}h rule)` : null;
  }
  const silent = now - lock.heartbeatAt;
  return silent > SYNC_LOCK_HEARTBEAT_STALE_MS ? `heartbeat silent for ${Math.round(silent / 1000)}s (limit ${SYNC_LOCK_HEARTBEAT_STALE_MS / 1000}s); holder presumed dead` : null;
}

/**
 * @param {{ owner: string, acquiredAt: number, heartbeatAt: number | null } | null} lock current lock state
 * @param {string} owner requesting caller
 * @param {number} now current time (injected for deterministic tests)
 * @param {{ heartbeat?: boolean }} [opts] heartbeat: caller will heartbeat (new client)
 * @returns {{ nextLock, result: {acquired: true} | {acquired: false, heldBy: string, heldSinceMs: number}, event: {kind: 'acquired'|'reacquired'|'reclaimed'|'denied', ...} }}
 */
export function tryAcquireSyncLock(lock, owner, now, opts = {}) {
  const reason = syncLockReclaimReason(lock, now);
  const live = reason ? null : lock;
  const heartbeatAt = opts.heartbeat ? now : null;
  if (live && live.owner !== owner) {
    return {
      nextLock: live,
      result: { acquired: false, heldBy: live.owner, heldSinceMs: now - live.acquiredAt },
      event: { kind: 'denied', heldBy: live.owner },
    };
  }
  // Same owner re-acquiring (a retry after a transient error, or re-taking the lock after a server
  // restart) keeps the original acquiredAt rather than resetting its own clock.
  const nextLock = { owner, acquiredAt: live ? live.acquiredAt : now, heartbeatAt: live && !opts.heartbeat ? live.heartbeatAt : heartbeatAt };
  const event = reason
    ? { kind: 'reclaimed', from: lock.owner, reason }
    : { kind: live ? 'reacquired' : 'acquired' };
  return { nextLock, result: { acquired: true }, event };
}

/**
 * Holder proves it is alive. Only the current owner can renew; a caller that has lost the lock
 * (reclaimed, or the server restarted and forgot it) is told so and by whom, never silently renewed.
 * @returns {{ nextLock, result: {renewed: true} | {renewed: false, heldBy: string | null} }}
 */
export function heartbeatSyncLock(lock, owner, now) {
  if (!lock) return { nextLock: lock, result: { renewed: false, heldBy: null } };
  if (lock.owner !== owner) return { nextLock: lock, result: { renewed: false, heldBy: lock.owner } };
  return { nextLock: { ...lock, heartbeatAt: now }, result: { renewed: true } };
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
