// The cross-box inventory-sync lock disappeared live on 2026-09-28 — it worked through
// 2026-09-27 but existed only as a hand-patch on the box, never committed here, and was lost when
// the box was redeployed during a fleet IP fix. Real coverage this time, so it can't silently
// vanish again without a test failing.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { tryAcquireSyncLock, releaseSyncLock, SYNC_LOCK_STALE_MS } from '../src/syncLock.js';

describe('tryAcquireSyncLock', () => {
  it('grants the lock when nothing holds it', () => {
    const { nextLock, result } = tryAcquireSyncLock(null, 'box1', 1000);
    assert.deepEqual(result, { acquired: true });
    assert.deepEqual(nextLock, { owner: 'box1', acquiredAt: 1000 });
  });

  it('denies a different owner while the lock is held, reporting who holds it and for how long', () => {
    const held = { owner: 'box1', acquiredAt: 1000 };
    const { nextLock, result } = tryAcquireSyncLock(held, 'box2', 5000);
    assert.deepEqual(result, { acquired: false, heldBy: 'box1', heldSinceMs: 4000 });
    assert.deepEqual(nextLock, held, 'lock state is unchanged on denial');
  });

  it('lets the same owner re-acquire (a retry after a transient error), keeping the original acquiredAt', () => {
    const held = { owner: 'box1', acquiredAt: 1000 };
    const { nextLock, result } = tryAcquireSyncLock(held, 'box1', 5000);
    assert.deepEqual(result, { acquired: true });
    assert.deepEqual(nextLock, { owner: 'box1', acquiredAt: 1000 }, 'acquiredAt is not reset');
  });

  it('self-heals a stale lock (a crashed holder that never released) and grants it to a new owner', () => {
    const held = { owner: 'box1', acquiredAt: 1000 };
    const { nextLock, result } = tryAcquireSyncLock(held, 'box2', 1000 + SYNC_LOCK_STALE_MS + 1);
    assert.deepEqual(result, { acquired: true });
    assert.deepEqual(nextLock, { owner: 'box2', acquiredAt: 1000 + SYNC_LOCK_STALE_MS + 1 });
  });

  it('does not treat a lock exactly at the staleness boundary as expired yet', () => {
    const held = { owner: 'box1', acquiredAt: 1000 };
    const { result } = tryAcquireSyncLock(held, 'box2', 1000 + SYNC_LOCK_STALE_MS);
    assert.deepEqual(result, { acquired: false, heldBy: 'box1', heldSinceMs: SYNC_LOCK_STALE_MS });
  });
});

describe('releaseSyncLock', () => {
  it('clears the lock when the actual holder releases it', () => {
    const held = { owner: 'box1', acquiredAt: 1000 };
    assert.equal(releaseSyncLock(held, 'box1'), null);
  });

  it('is a no-op when a non-holder tries to release (never lets a stray owner steal a release)', () => {
    const held = { owner: 'box1', acquiredAt: 1000 };
    assert.deepEqual(releaseSyncLock(held, 'box2'), held);
  });

  it('is a no-op when nothing is held', () => {
    assert.equal(releaseSyncLock(null, 'box1'), null);
  });
});
