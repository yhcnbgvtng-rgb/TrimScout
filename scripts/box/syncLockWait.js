// Pure wait/poll orchestration for inventory-sync.mjs's client-side lock acquisition — extracted
// so it's unit-testable without a real HTTP server or real timers (same reason syncLock.js is its
// own module).
//
// Previously this gave up after 3h (`maxWaitMs`) and threw, which exited the whole sync process —
// on a genuinely busy night (2026-09-28) a box's sync sat behind another box's for longer than
// that and simply died instead of just... continuing to wait, leaving that box's inventory stale
// until someone noticed and relaunched it by hand. There's no reason a waiter needs to give up
// this early: the lock is a plain serialization mechanism (one sync writes at a time), not a
// sign anything is wrong, and the runner script that invokes this (run_sync_when_safe.sh) already
// tolerates waiting up to 20h for the CRAWLER's own lock before it even starts a sync — this cap
// matches that same budget, so "how long are we willing to wait tonight" is one number, not two.
//
// Injectable `tryAcquire`/`sleep`/`now` so tests can simulate hours of polling without any real
// delay and without a live lock server.
export async function waitForSyncLock({ tryAcquire, sleep, now = Date.now, pollMs = 30_000, maxWaitMs = 20 * 60 * 60 * 1000, onPoll } = {}) {
  const start = now();
  for (;;) {
    const r = await tryAcquire();
    if (r.acquired) return r;
    const waitedMs = now() - start;
    if (onPoll) onPoll({ heldBy: r.heldBy, heldSinceMs: r.heldSinceMs, waitedMs });
    if (waitedMs >= maxWaitMs) throw new Error(`gave up waiting for the sync lock after ${maxWaitMs}ms (held by ${r.heldBy})`);
    await sleep(pollMs);
  }
}
