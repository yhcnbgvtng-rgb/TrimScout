// The queue's state machine: biggest shard first, leases that lapse and requeue, attempts, and tokens that stop a zombie.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { queueNight, claim, heartbeat, finish, reapExpired, pickNext, summarize, JOB, DEFAULTS, jobKey, parseJobKey } from '../src/crawlQueueCore.js';

const mk = (key, est, extra = {}) => ({ jobKey: key, state: key.split('|')[0], brand: key.split('|')[1], brandSet: 'core', estSeconds: est, heavy: false, status: JOB.QUEUED, attempts: 0, maxAttempts: 2, claimedBy: null, claimToken: null, leaseExpiresAt: null, lastFailedBox: null, ...extra });
const T0 = 1_000_000;

describe('queueNight', () => {
  const et = (iso) => queueNight(Date.parse(iso));
  it('rolls over exactly at the 22:00 ET cron time', () => {
    assert.equal(et('2026-10-14T21:59:59-04:00'), '2026-10-13');
    assert.equal(et('2026-10-14T22:00:00-04:00'), '2026-10-14');
  });
  it('keeps a second stage that starts the next evening (after a 23h first stage) in the same night', () => {
    assert.equal(et('2026-10-12T22:00:01-04:00'), '2026-10-12');
    assert.equal(et('2026-10-13T21:24:00-04:00'), '2026-10-12'); // the real 2026-10-12 core-stage start on box3
  });
  it('a sync that starts after midnight still belongs to the night that crawled', () => {
    assert.equal(et('2026-10-14T07:30:00-04:00'), '2026-10-13');
  });
  it('is correct across the autumn DST change', () => {
    assert.equal(et('2026-11-01T22:00:00-05:00'), '2026-11-01');
    assert.equal(et('2026-11-01T21:59:00-05:00'), '2026-10-31');
  });
});

describe('claim: biggest first', () => {
  it('hands out the longest estimated job, then the next longest', () => {
    let jobs = [mk('TX|Ford', 7000), mk('NJ|Honda', 300), mk('CA|Toyota', 6000)];
    const order = [];
    for (let i = 0; i < 3; i++) { const r = claim(jobs, { box: 'box3' }, T0, { newToken: () => `t${i}` }); order.push(r.claimed.jobKey); jobs = r.jobs; }
    assert.deepEqual(order, ['TX|Ford', 'CA|Toyota', 'NJ|Honda']);
  });
  it('breaks a tie on job key so the choice is deterministic', () => {
    assert.equal(pickNext([mk('B|x', 10), mk('A|x', 10)], { box: 'b' }).jobKey, 'A|x');
  });
  it('returns null when nothing is queued and does not invent work', () => {
    const r = claim([mk('A|x', 1, { status: JOB.DONE })], { box: 'b' }, T0);
    assert.equal(r.claimed, null);
  });
  it('counts the attempt and sets a lease', () => {
    const r = claim([mk('A|x', 1)], { box: 'box1' }, T0, { newToken: () => 'tok' });
    assert.equal(r.claimed.attempts, 1);
    assert.equal(r.claimed.claimedBy, 'box1');
    assert.equal(r.claimed.leaseExpiresAt, T0 + DEFAULTS.LEASE_MS);
    assert.equal(r.claimed.claimToken, 'tok');
  });
});

describe('claim: who may take what', () => {
  it('a box limited to the core brand set never gets an expansion shard', () => {
    const jobs = [mk('TX|Ford', 9000, { brandSet: 'expansion' }), mk('TX|Toyota', 100)];
    assert.equal(pickNext(jobs, { box: 'box1', brandSets: ['core'] }).jobKey, 'TX|Toyota');
  });
  it('a box at its heavy-job limit is not offered a heavy shard', () => {
    const jobs = [mk('TX|Ford', 9000, { heavy: true }), mk('TX|Toyota', 100)];
    assert.equal(pickNext(jobs, { box: 'b', allowHeavy: false }).jobKey, 'TX|Toyota');
    assert.equal(pickNext(jobs, { box: 'b', allowHeavy: true }).jobKey, 'TX|Ford');
  });
  it('a shard that failed on a box is retried on a different box', () => {
    const jobs = [mk('A|x', 100, { attempts: 1, lastFailedBox: 'box3' })];
    assert.equal(pickNext(jobs, { box: 'box3' }), null);
    assert.equal(pickNext(jobs, { box: 'box4' }).jobKey, 'A|x');
  });
  it('skipKeys excludes shards this box cannot run', () => {
    assert.equal(pickNext([mk('A|x', 5), mk('B|x', 4)], { box: 'b', skipKeys: ['A|x'] }).jobKey, 'B|x');
  });
});

describe('leases: a crashed or stalled box\'s shard goes back to the queue', () => {
  const claimed = () => claim([mk('A|x', 100)], { box: 'box3' }, T0, { newToken: () => 'old' }).jobs;
  it('a live lease is left alone', () => {
    const r = reapExpired(claimed(), T0 + DEFAULTS.LEASE_MS - 1);
    assert.equal(r.reaped.length, 0);
    assert.equal(r.jobs[0].status, JOB.CLAIMED);
  });
  it('an expired lease requeues the job, remembering which box dropped it', () => {
    const r = reapExpired(claimed(), T0 + DEFAULTS.LEASE_MS + 1);
    assert.equal(r.jobs[0].status, JOB.QUEUED);
    assert.equal(r.jobs[0].lastFailedBox, 'box3');
    assert.equal(r.jobs[0].claimToken, null);
    assert.deepEqual(r.reaped, [{ jobKey: 'A|x', from: 'box3', exhausted: false }]);
  });
  it('is applied by claim, so the next box to ask picks the orphan up (on another box than the one that dropped it)', () => {
    const r = claim(claimed(), { box: 'box4' }, T0 + DEFAULTS.LEASE_MS + 5, { newToken: () => 'new' });
    assert.equal(r.claimed.jobKey, 'A|x');
    assert.equal(r.claimed.attempts, 2);
    assert.equal(r.claimed.claimToken, 'new');
  });
  it('after the last attempt an expired lease ends the job as failed instead of looping forever', () => {
    const j = [mk('A|x', 100, { attempts: 2, status: JOB.CLAIMED, claimedBy: 'box4', claimToken: 't', leaseExpiresAt: T0 })];
    const r = reapExpired(j, T0 + 1);
    assert.equal(r.jobs[0].status, JOB.FAILED);
    assert.equal(r.reaped[0].exhausted, true);
  });
  it('heartbeats renew only for the holder of the current token', () => {
    const jobs = claimed();
    const good = heartbeat(jobs, { jobKey: 'A|x', token: 'old' }, T0 + 60_000);
    assert.equal(good.renewed, true);
    assert.equal(good.jobs[0].leaseExpiresAt, T0 + 60_000 + DEFAULTS.LEASE_MS);
    assert.equal(heartbeat(jobs, { jobKey: 'A|x', token: 'stolen' }, T0 + 1).renewed, false);
    assert.equal(heartbeat(jobs, { jobKey: 'nope', token: 'old' }, T0 + 1).renewed, false);
  });
  it('a worker whose lease was reaped is told so on its next heartbeat', () => {
    const reaped = claim(claimed(), { box: 'box4' }, T0 + DEFAULTS.LEASE_MS + 5, { newToken: () => 'new' }).jobs;
    const r = heartbeat(reaped, { jobKey: 'A|x', token: 'old' }, T0 + DEFAULTS.LEASE_MS + 10);
    assert.equal(r.renewed, false);
  });
});

describe('finish: attempts, timeouts, and zombies', () => {
  const held = (extra = {}) => claim([mk('A|x', 100, extra)], { box: 'box3' }, T0, { newToken: () => 'tok' }).jobs;
  it('success marks done with the duration', () => {
    const r = finish(held(), { jobKey: 'A|x', token: 'tok', ok: true, durationSeconds: 90 }, T0 + 90_000);
    assert.equal(r.accepted, true);
    assert.equal(r.jobs[0].status, JOB.DONE);
    assert.equal(r.jobs[0].durationSeconds, 90);
  });
  it('a failure with attempts left goes back to the queue', () => {
    const r = finish(held(), { jobKey: 'A|x', token: 'tok', ok: false, error: 'boom' }, T0 + 1);
    assert.equal(r.status, JOB.QUEUED);
    assert.equal(r.jobs[0].lastFailedBox, 'box3');
  });
  it('a failure on the last attempt is terminal', () => {
    const j = claim([mk('A|x', 100, { attempts: 1 })], { box: 'box3' }, T0, { newToken: () => 'tok' }).jobs;
    assert.equal(finish(j, { jobKey: 'A|x', token: 'tok', ok: false, error: 'boom' }, T0 + 1).status, JOB.FAILED);
  });
  it('a 2h-kill timeout is terminal at once (retryable:false) even with attempts left', () => {
    const r = finish(held(), { jobKey: 'A|x', token: 'tok', ok: false, retryable: false, exit: 'timeout' }, T0 + 1);
    assert.equal(r.status, JOB.FAILED);
    assert.equal(r.jobs[0].exitStatus, 'timeout');
  });
  it('a stale token cannot complete or fail a job that now belongs to someone else', () => {
    const j = held();
    assert.equal(finish(j, { jobKey: 'A|x', token: 'zombie', ok: true }, T0 + 1).accepted, false);
    assert.equal(finish(j, { jobKey: 'A|x', token: 'zombie', ok: false }, T0 + 1).accepted, false);
  });
  it('a finished job cannot be finished twice', () => {
    const done = finish(held(), { jobKey: 'A|x', token: 'tok', ok: true }, T0 + 1).jobs;
    assert.equal(finish(done, { jobKey: 'A|x', token: 'tok', ok: false }, T0 + 2).accepted, false);
  });
});

describe('helpers', () => {
  it('summarize counts open work as queued + claimed', () => {
    const c = summarize([mk('a|x', 1), mk('b|x', 1, { status: JOB.CLAIMED }), mk('c|x', 1, { status: JOB.DONE }), mk('d|x', 1, { status: JOB.FAILED })]);
    assert.deepEqual({ q: c.queued, c: c.claimed, d: c.done, f: c.failed, open: c.open }, { q: 1, c: 1, d: 1, f: 1, open: 2 });
  });
  it('job keys round-trip, including a brand containing a dash', () => {
    assert.deepEqual(parseJobKey(jobKey('tx', 'Mercedes-Benz')), { state: 'TX', brand: 'Mercedes-Benz' });
  });
});
