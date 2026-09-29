// waitForSyncLock used to give up after 3h and throw, which killed the whole sync process on a
// busy night. Now it keeps polling until the lock frees up, capped at the runner's own 20h
// crawl-lock budget. Simulated clock/sleep so this exercises hours of polling with no real delay.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { waitForSyncLock } from '../../../scripts/box/syncLockWait.js';

function fakeClock(start = 0) {
  let t = start;
  return {
    now: () => t,
    sleep: async (ms) => {
      t += ms;
    },
  };
}

describe('waitForSyncLock', () => {
  it('polls past the old 3h cutoff without exiting, then acquires once the holder releases', async () => {
    const { now, sleep } = fakeClock();
    const pollMs = 5 * 60 * 1000; // 5 min
    let calls = 0;
    const polls = [];
    const tryAcquire = async () => {
      calls++;
      // Held for 40 polls (200 min > 180 min / 3h) before releasing.
      if (calls <= 40) return { acquired: false, heldBy: 'box2-inventory-999', heldSinceMs: calls * pollMs };
      return { acquired: true };
    };
    const result = await waitForSyncLock({
      tryAcquire,
      sleep,
      now,
      pollMs,
      maxWaitMs: 20 * 60 * 60 * 1000,
      onPoll: (info) => polls.push(info),
    });
    assert.deepEqual(result, { acquired: true });
    assert.equal(calls, 41);
    // Confirms it kept going well past the old 3h (10_800_000ms) cutoff.
    assert.ok(polls.some((p) => p.waitedMs > 3 * 60 * 60 * 1000), 'waited past the old 3h cutoff');
    assert.equal(polls.at(-1).heldBy, 'box2-inventory-999');
  });

  it('logs the holder and elapsed wait on every poll', async () => {
    const { now, sleep } = fakeClock();
    const pollMs = 1000;
    let calls = 0;
    const polls = [];
    const tryAcquire = async () => {
      calls++;
      if (calls <= 3) return { acquired: false, heldBy: 'box3-inventory-1', heldSinceMs: 12345 };
      return { acquired: true };
    };
    await waitForSyncLock({ tryAcquire, sleep, now, pollMs, onPoll: (info) => polls.push(info) });
    assert.equal(polls.length, 3);
    for (const [i, p] of polls.entries()) {
      assert.equal(p.heldBy, 'box3-inventory-1');
      assert.equal(p.heldSinceMs, 12345);
      assert.equal(p.waitedMs, i * pollMs);
    }
  });

  it('exits (throws) only once the cap is reached, not before', async () => {
    const { now, sleep } = fakeClock();
    const tryAcquire = async () => ({ acquired: false, heldBy: 'box4-inventory-7', heldSinceMs: 999 });
    await assert.rejects(
      () => waitForSyncLock({ tryAcquire, sleep, now, pollMs: 60_000, maxWaitMs: 5 * 60_000 }),
      /gave up waiting for the sync lock after 300000ms \(held by box4-inventory-7\)/
    );
  });
});
