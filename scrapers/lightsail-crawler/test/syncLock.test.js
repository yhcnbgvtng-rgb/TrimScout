// The cross-box inventory-sync lock disappeared live on 2026-09-28 — it worked through
// 2026-09-27 but existed only as a hand-patch on the box, never committed here, and was lost when
// the box was redeployed during a fleet IP fix. Real coverage this time, so it can't silently
// vanish again without a test failing.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  tryAcquireSyncLock, releaseSyncLock, heartbeatSyncLock, syncLockReclaimReason,
  SYNC_LOCK_STALE_MS, SYNC_LOCK_HEARTBEAT_STALE_MS, SYNC_LOCK_HEARTBEAT_INTERVAL_MS, SYNC_LOCK_MAX_HOLD_MS,
} from '../src/syncLock.js';

describe('tryAcquireSyncLock', () => {
  it('grants the lock when nothing holds it', () => {
    const { nextLock, result } = tryAcquireSyncLock(null, 'box1', 1000);
    assert.deepEqual(result, { acquired: true });
    assert.deepEqual(nextLock, { owner: 'box1', acquiredAt: 1000, heartbeatAt: null });
  });

  it('denies a different owner while the lock is held, reporting who holds it and for how long', () => {
    const held = { owner: 'box1', acquiredAt: 1000, heartbeatAt: null };
    const { nextLock, result } = tryAcquireSyncLock(held, 'box2', 5000);
    assert.deepEqual(result, { acquired: false, heldBy: 'box1', heldSinceMs: 4000 });
    assert.deepEqual(nextLock, held, 'lock state is unchanged on denial');
  });

  it('lets the same owner re-acquire (a retry after a transient error), keeping the original acquiredAt', () => {
    const held = { owner: 'box1', acquiredAt: 1000, heartbeatAt: null };
    const { nextLock, result } = tryAcquireSyncLock(held, 'box1', 5000);
    assert.deepEqual(result, { acquired: true });
    assert.deepEqual(nextLock, { owner: 'box1', acquiredAt: 1000, heartbeatAt: null }, 'acquiredAt is not reset');
  });

  it('legacy holder (never heartbeats): the old 3h rule still self-heals a crashed one', () => {
    const held = { owner: 'box1', acquiredAt: 1000, heartbeatAt: null };
    const { nextLock, result } = tryAcquireSyncLock(held, 'box2', 1000 + SYNC_LOCK_STALE_MS + 1);
    assert.deepEqual(result, { acquired: true });
    assert.deepEqual(nextLock, { owner: 'box2', acquiredAt: 1000 + SYNC_LOCK_STALE_MS + 1, heartbeatAt: null });
  });

  it('does not treat a lock exactly at the staleness boundary as expired yet', () => {
    const held = { owner: 'box1', acquiredAt: 1000, heartbeatAt: null };
    const { result } = tryAcquireSyncLock(held, 'box2', 1000 + SYNC_LOCK_STALE_MS);
    assert.deepEqual(result, { acquired: false, heldBy: 'box1', heldSinceMs: SYNC_LOCK_STALE_MS });
  });
});

describe('releaseSyncLock', () => {
  it('clears the lock when the actual holder releases it', () => {
    const held = { owner: 'box1', acquiredAt: 1000, heartbeatAt: null };
    assert.equal(releaseSyncLock(held, 'box1'), null);
  });

  it('is a no-op when a non-holder tries to release (never lets a stray owner steal a release)', () => {
    const held = { owner: 'box1', acquiredAt: 1000, heartbeatAt: null };
    assert.deepEqual(releaseSyncLock(held, 'box2'), held);
  });

  it('is a no-op when nothing is held', () => {
    assert.equal(releaseSyncLock(null, 'box1'), null);
  });
});

describe('liveness: heartbeat instead of elapsed hold time', () => {
  const HOUR = 3600 * 1000;
  const acquire = (lock, owner, now) => tryAcquireSyncLock(lock, owner, now, { heartbeat: true });

  it('REGRESSION 2026-10-01: a slow holder that keeps heartbeating is NOT reclaimed past 3h (5h+ held, box3 asks)', () => {
    let lock = acquire(null, 'box1', 0).nextLock;
    // box1 heartbeats every 30s for 5h while box3 polls every 30s.
    for (let t = SYNC_LOCK_HEARTBEAT_INTERVAL_MS; t <= 5 * HOUR; t += SYNC_LOCK_HEARTBEAT_INTERVAL_MS) {
      lock = heartbeatSyncLock(lock, 'box1', t).nextLock;
      const r = acquire(lock, 'box3', t);
      assert.equal(r.result.acquired, false, `box3 must not steal at t=${t}`);
      assert.equal(r.event.kind, 'denied');
      lock = r.nextLock;
    }
    assert.equal(lock.owner, 'box1');
  });

  it('a holder that dies without releasing is reclaimed after the heartbeat goes silent, with a logged reason', () => {
    let lock = acquire(null, 'box1', 0).nextLock;
    lock = heartbeatSyncLock(lock, 'box1', 60_000).nextLock; // last beat at 1 min, then the process dies
    const justBefore = acquire(lock, 'box3', 60_000 + SYNC_LOCK_HEARTBEAT_STALE_MS);
    assert.equal(justBefore.result.acquired, false, 'exactly at the limit is still alive');
    const after = acquire(lock, 'box3', 60_000 + SYNC_LOCK_HEARTBEAT_STALE_MS + 1);
    assert.equal(after.result.acquired, true);
    assert.equal(after.event.kind, 'reclaimed');
    assert.equal(after.event.from, 'box1');
    assert.match(after.event.reason, /heartbeat silent/);
    assert.equal(after.nextLock.owner, 'box3');
  });

  it('dual-writer regression: after a reclaim the old holder can no longer renew and is told who has the lock', () => {
    let lock = acquire(null, 'box1', 0).nextLock;
    lock = acquire(lock, 'box3', SYNC_LOCK_HEARTBEAT_STALE_MS + 1).nextLock; // reclaimed
    const r = heartbeatSyncLock(lock, 'box1', SYNC_LOCK_HEARTBEAT_STALE_MS + 2);
    assert.deepEqual(r.result, { renewed: false, heldBy: 'box3' });
    assert.equal(r.nextLock.owner, 'box3', 'a stray heartbeat must not change ownership');
  });

  it('heartbeat after a server restart (nothing held) is rejected with heldBy null so the client can re-acquire', () => {
    assert.deepEqual(heartbeatSyncLock(null, 'box1', 5).result, { renewed: false, heldBy: null });
  });

  it('a healthy 5h legacy-client holder is still the old behavior (reclaimable after 3h) — only heartbeating holders are protected', () => {
    const legacy = tryAcquireSyncLock(null, 'box1', 0).nextLock;
    assert.equal(legacy.heartbeatAt, null);
    assert.match(syncLockReclaimReason(legacy, SYNC_LOCK_STALE_MS + 1), /legacy/);
  });

  it('a heartbeating holder is protected from the legacy 3h rule but not from the absolute cap', () => {
    let lock = acquire(null, 'box1', 0).nextLock;
    lock = heartbeatSyncLock(lock, 'box1', SYNC_LOCK_MAX_HOLD_MS + 10).nextLock;
    const reason = syncLockReclaimReason(lock, SYNC_LOCK_MAX_HOLD_MS + 20);
    assert.match(reason, /absolute cap/);
    assert.equal(syncLockReclaimReason(heartbeatSyncLock(acquire(null, 'b', 0).nextLock, 'b', 6 * HOUR).nextLock, 6 * HOUR + 1), null);
  });

  it('same owner re-acquiring (e.g. after a deals-api restart) upgrades to heartbeat tracking and keeps acquiredAt', () => {
    const legacy = tryAcquireSyncLock(null, 'box1', 100).nextLock;
    const r = acquire(legacy, 'box1', 900);
    assert.equal(r.event.kind, 'reacquired');
    assert.deepEqual(r.nextLock, { owner: 'box1', acquiredAt: 100, heartbeatAt: 900 });
  });

  it('a normal first acquire reports an acquired event; a denial reports denied (never silent)', () => {
    assert.equal(acquire(null, 'box1', 0).event.kind, 'acquired');
    const held = acquire(null, 'box1', 0).nextLock;
    assert.deepEqual(acquire(held, 'box2', 5).event, { kind: 'denied', heldBy: 'box1' });
  });
});
