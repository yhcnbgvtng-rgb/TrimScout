// The worker loop with a fake queue client and a controllable clock: draining, lease loss, rejected completions, retries on
// API trouble, budget, heavy limits, and that nothing unfinished ever reaches the sync manifest.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { runWorker } from '../src/crawlQueueWorker.js';
import { makeOps, memoryStore } from '../src/crawlQueueServer.js';

const flag = (o = {}) => ({ enabled: true, box: 'box3', role: 'worker', slots: 2, brandSets: null, maxHeavy: 1, ...o });
const job = (state, brand, est, o = {}) => ({ state, brand, brandSet: 'core', dealers: 5, estSeconds: est, heavy: false, ...o });
const quiet = () => {};

function localClient(ops, box = 'box3') {
  return {
    claim: (a) => ops.claim({ ...a, box }), heartbeat: (a) => ops.heartbeat(a), complete: (a) => ops.complete(a), fail: (a) => ops.fail(a),
  };
}
const nap = (ms) => new Promise((r) => setTimeout(r, ms));

describe('runWorker', () => {
  it('drains the queue across slots, biggest first, and reports every result', async () => {
    const ops = makeOps(memoryStore());
    await ops.seed({ night: 'n-1234', jobs: [job('AK', 'a', 1), job('AL', 'b', 3), job('AR', 'c', 2)] });
    const ran = []; const finished = [];
    const res = await runWorker({ client: localClient(ops), flag: flag({ slots: 1 }), night: 'n-1234', log: quiet, pollMs: 1, sleep: nap, runJob: async (j) => { ran.push(j.jobKey); return { ok: true, vehicles: 7 }; }, onFinished: async (j) => finished.push(j.jobKey) });
    assert.deepEqual(ran, ['AL|b', 'AR|c', 'AK|a']);
    assert.deepEqual(finished, ran);
    assert.equal(res.filter((r) => r.outcome === 'done').length, 3);
  });
  it('two slots never run the same shard', async () => {
    const ops = makeOps(memoryStore());
    await ops.seed({ night: 'n-1234', jobs: Array.from({ length: 12 }, (_, i) => job(['AK', 'AL', 'AR', 'AZ', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA', 'HI', 'IA'][i], 'x', 100 - i)) });
    const ran = [];
    await runWorker({ client: localClient(ops), flag: flag({ slots: 4 }), night: 'n-1234', log: quiet, sleep: nap, pollMs: 1, standbyMs: 3, runJob: async (j) => { ran.push(j.jobKey); await nap(2); return { ok: true }; } });
    assert.equal(new Set(ran).size, 12);
  });
  it('a shard skipped by the bot-protection report is completed but never put in the manifest', async () => {
    const ops = makeOps(memoryStore());
    await ops.seed({ night: 'n-1234', jobs: [job('AK', 'a', 1)] });
    const finished = [];
    const res = await runWorker({ client: localClient(ops), flag: flag({ slots: 1 }), night: 'n-1234', log: quiet, sleep: nap, pollMs: 1, standbyMs: 3, runJob: async () => ({ ok: true, skipped: true, exit: 'skipped-bot-report' }), onFinished: async (j, r) => finished.push(r.skipped) });
    assert.equal(res[0].outcome, 'skipped');
    assert.deepEqual(finished, [true]); // the caller decides: it skips the manifest when res.skipped
  });
  it('a failed shard is reported, retried on ANOTHER box only, and a timeout is not retried at all', async () => {
    const ops = makeOps(memoryStore());
    await ops.seed({ night: 'n-1234', jobs: [job('AK', 'a', 3), job('AL', 'b', 2)] });
    const calls = [];
    await runWorker({ client: localClient(ops, 'box3'), flag: flag({ slots: 1, box: 'box3' }), night: 'n-1234', log: quiet, sleep: nap, pollMs: 1, idlePollsBeforeExit: 2, runJob: async (j) => { calls.push(j.jobKey); return j.jobKey === 'AK|a' ? { ok: false, retryable: true, error: 'crash', exit: 'error' } : { ok: false, retryable: false, error: 'killed', exit: 'timeout' }; } });
    assert.deepEqual(calls, ['AK|a', 'AL|b']); // box3 does not get AK|a back
    const st = await ops.status({ night: 'n-1234' });
    assert.equal(st.counts.failed, 1); // AL (timeout, terminal)
    assert.equal(st.counts.queued, 1); // AK waits for a different box
    const other = [];
    await runWorker({ client: localClient(ops, 'box4'), flag: flag({ slots: 1, box: 'box4' }), night: 'n-1234', log: quiet, sleep: nap, pollMs: 1, standbyMs: 3, runJob: async (j) => { other.push(j.jobKey); return { ok: true }; } });
    assert.deepEqual(other, ['AK|a']);
  });
  it('a lost lease discards the result: never reported, never in the manifest, and the other box owns the shard', async () => {
    let t = 0; let partitioned = false;
    const ops = makeOps(memoryStore(), { now: () => t, leaseMs: 100 });
    await ops.seed({ night: 'n-1234', jobs: [job('AK', 'a', 1)] });
    const finished = [];
    const client = { ...localClient(ops, 'box3'), heartbeat: async (a) => { if (partitioned) throw new Error('network partition'); return ops.heartbeat(a); } };
    const slow = runWorker({ client, flag: flag({ slots: 1 }), night: 'n-1234', log: quiet, sleep: nap, heartbeatMs: 5, pollMs: 1,
      runJob: async () => { partitioned = true; t += 1000; await nap(40); partitioned = false; await nap(30); return { ok: true, vehicles: 1 }; }, onFinished: async (j) => finished.push(j.jobKey) });
    await nap(15);
    // box3 is cut off and silent; its lease lapses and box4 takes the shard
    const taken = await ops.claim({ night: 'n-1234', box: 'box4' });
    assert.equal(taken.claimed.jobKey, 'AK|a');
    await ops.complete({ night: 'n-1234', jobKey: 'AK|a', token: taken.claimed.token });
    const res = await slow;
    assert.deepEqual(finished, []);
    assert.equal(res[0].outcome, 'lease-lost');
  });
  it('a completion the server rejects is discarded, not added to the manifest', async () => {
    const client = { claim: async () => ({ claimed: { jobKey: 'AK|a', state: 'AK', brand: 'a', token: 't', dealers: 1, estSeconds: 1, attempt: 1 }, counts: { open: 1 } }), heartbeat: async () => ({ renewed: true }), complete: async () => ({ accepted: false, reason: 'claimed by someone else' }), fail: async () => ({}) };
    const finished = []; let first = true;
    const flagged = flag({ slots: 1 });
    const res = await runWorker({ client: { ...client, claim: async () => { if (first) { first = false; return client.claim(); } return { claimed: null, counts: { open: 0 } }; } }, flag: flagged, night: 'n-1234', log: quiet, sleep: nap, pollMs: 1, standbyMs: 3, runJob: async () => ({ ok: true }), onFinished: async (j) => finished.push(j) });
    assert.deepEqual(finished, []);
    assert.equal(res[0].outcome, 'rejected');
  });
  it('survives transient API errors and stops cleanly after too many in a row', async () => {
    let n = 0;
    const client = { claim: async () => { n++; throw Object.assign(new Error('ECONNRESET'), { retryable: true }); }, heartbeat: async () => ({}), complete: async () => ({}), fail: async () => ({}) };
    const res = await runWorker({ client, flag: flag({ slots: 1 }), night: 'n-1234', log: quiet, sleep: async () => {}, maxApiFailures: 3, runJob: async () => ({ ok: true }) });
    assert.equal(n, 3);
    assert.deepEqual(res, []);
  });
  it('does not start anything after the budget is spent', async () => {
    const ops = makeOps(memoryStore());
    await ops.seed({ night: 'n-1234', jobs: [job('AK', 'a', 1)] });
    let ran = 0; let t = 0;
    await runWorker({ client: localClient(ops), flag: flag({ slots: 1 }), night: 'n-1234', log: quiet, sleep: nap, pollMs: 1, standbyMs: 3, now: () => t, startedAt: 0, deadlineMs: 1000, runJob: async () => { ran++; return { ok: true }; } , onFinished: async () => { t += 2000; } });
    assert.equal(ran, 1);
    // queue now has nothing, so craft a second job and confirm the expired deadline stops the second claim
    await ops.seed({ night: 'n-1234', jobs: [job('AL', 'b', 1)] });
    t = 5000;
    await runWorker({ client: localClient(ops), flag: flag({ slots: 1 }), night: 'n-1234', log: quiet, sleep: nap, pollMs: 1, standbyMs: 3, now: () => t, startedAt: 0, deadlineMs: 1000, runJob: async () => { ran++; return { ok: true }; } });
    assert.equal(ran, 1);
  });
  it('never runs more heavy shards at once than the box allows', async () => {
    const ops = makeOps(memoryStore());
    await ops.seed({ night: 'n-1234', jobs: ['AK', 'AL', 'AR', 'AZ'].map((s, i) => job(s, 'x', 100 - i, { heavy: true })).concat([job('CA', 'y', 1)]) });
    let live = 0; let peak = 0;
    await runWorker({ client: localClient(ops), flag: flag({ slots: 3, maxHeavy: 1 }), night: 'n-1234', log: quiet, sleep: nap, pollMs: 1, runJob: async (j) => { if (j.heavy) { live++; peak = Math.max(peak, live); await nap(5); live--; } return { ok: true }; } });
    assert.equal(peak, 1);
    assert.equal((await ops.status({ night: 'n-1234' })).counts.done, 5);
  });
  it('when only other boxes\' jobs remain it waits a short standby, then leaves so the box can sync', async () => {
    const ops = makeOps(memoryStore());
    await ops.seed({ night: 'n-1234', jobs: [job('AK', 'a', 5)] });
    await ops.claim({ night: 'n-1234', box: 'box4' }); // box4 is running the last shard and will not finish
    let polls = 0;
    const res = await runWorker({ client: localClient(ops, 'box3'), flag: flag({ slots: 1 }), night: 'n-1234', log: quiet, sleep: async () => { polls++; }, pollMs: 1, standbyMs: 5, runJob: async () => ({ ok: true }) });
    assert.deepEqual(res, []);
    assert.equal(polls, 4);
  });
  it('during that standby it picks up a shard whose box died', async () => {
    let t = 0;
    const ops = makeOps(memoryStore(), { now: () => t, leaseMs: 100 });
    await ops.seed({ night: 'n-1234', jobs: [job('AK', 'a', 5)] });
    await ops.claim({ night: 'n-1234', box: 'box4' });
    const ran = [];
    await runWorker({ client: localClient(ops, 'box3'), flag: flag({ slots: 1 }), night: 'n-1234', log: quiet, sleep: async () => { t += 60; }, pollMs: 1, standbyMs: 50, runJob: async (j) => { ran.push(j.jobKey); return { ok: true }; } });
    assert.deepEqual(ran, ['AK|a']);
  });
  it('a runner that throws is a retryable failure, not a crashed worker', async () => {
    const ops = makeOps(memoryStore());
    await ops.seed({ night: 'n-1234', jobs: [job('AK', 'a', 1)] });
    const res = await runWorker({ client: localClient(ops), flag: flag({ slots: 1 }), night: 'n-1234', log: quiet, sleep: nap, pollMs: 1, idlePollsBeforeExit: 1, runJob: async () => { throw new Error('kaboom'); } });
    assert.equal(res[0].outcome, 'failed');
    assert.equal((await ops.status({ night: 'n-1234' })).counts.queued, 1);
  });
});
