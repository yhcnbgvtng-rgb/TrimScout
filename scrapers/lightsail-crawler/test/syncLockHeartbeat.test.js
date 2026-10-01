import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { startSyncLockHeartbeat } from '../../../scripts/box/syncLockHeartbeat.js';

function harness(heartbeatImpl, reacquireImpl = async () => ({ acquired: true })) {
  const logs = [];
  let tickFn = null;
  let cleared = false;
  const hb = startSyncLockHeartbeat({
    heartbeat: heartbeatImpl,
    reacquire: reacquireImpl,
    log: (m) => logs.push(m),
    setIntervalFn: (fn) => { tickFn = fn; return { unref() {} }; },
    clearIntervalFn: () => { cleared = true; },
  });
  return { hb, logs, tick: () => hb.tick(), wasCleared: () => cleared, hasTimer: () => tickFn !== null };
}

describe('startSyncLockHeartbeat', () => {
  it('schedules a timer, stays quiet while renewals succeed, and stops on request', async () => {
    const h = harness(async () => ({ renewed: true }));
    assert.equal(h.hasTimer(), true);
    await h.tick(); await h.tick();
    assert.deepEqual(h.logs, []);
    assert.equal(h.hb.isLost(), false);
    h.hb.stop();
    assert.equal(h.wasCleared(), true);
  });

  it('after a deals-api restart (nobody holds the lock) it re-acquires and says so', async () => {
    const h = harness(async () => ({ renewed: false, heldBy: null }));
    await h.tick();
    assert.match(h.logs[0], /re-acquired/);
    assert.equal(h.hb.isLost(), false);
  });

  it('if another box reclaimed the lock it logs LOCK LOST loudly and reports lost', async () => {
    const h = harness(async () => ({ renewed: false, heldBy: 'box3-xyz' }));
    await h.tick();
    assert.match(h.logs[0], /LOCK LOST.*box3-xyz.*concurrently/);
    assert.equal(h.hb.isLost(), true);
  });

  it('a transient network error is logged and does not throw or mark the lock lost', async () => {
    const h = harness(async () => { throw new Error('fetch failed'); });
    await h.tick();
    assert.match(h.logs[0], /will retry.*fetch failed/);
    assert.equal(h.hb.isLost(), false);
  });

  it('never overlaps ticks when a heartbeat call is slow', async () => {
    let calls = 0; let release;
    const h = harness(() => { calls++; return new Promise((r) => { release = () => r({ renewed: true }); }); });
    const first = h.tick(); const second = h.tick();
    await second; release(); await first;
    assert.equal(calls, 1);
  });
});
