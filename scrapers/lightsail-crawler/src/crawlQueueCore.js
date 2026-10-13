// Shared, dependency-free pieces of the crawl shard queue (2026-10-13): the "night" key, job keys, defaults, and the
// pure state machine behind the queue table on box2. Nothing here does I/O, so the server module, the worker and the
// tests all run exactly the same transition logic (see crawlQueueServer.js for the SQL wrapper around it).
//
// One job = one (state, brand) dealer shard — the same unit as the per-brand data files `<ST>__<brand-slug>.json`
// (inventory_shards.js). A job moves queued -> claimed -> done, or back to queued when its lease lapses or the worker
// reports a retryable failure, until it runs out of attempts and ends 'failed'.

export const JOB = Object.freeze({ QUEUED: 'queued', CLAIMED: 'claimed', DONE: 'done', FAILED: 'failed' });

export const DEFAULTS = Object.freeze({
  // A claim is a lease. The worker renews it every HEARTBEAT_MS; if nothing arrives for LEASE_MS the next claim call puts
  // the job back in the queue. 15 min tolerates a slow/loaded box2 (heartbeats are tiny) without leaving a dead box's
  // shard unclaimed for long; it is NOT the shard time limit (that stays the driver's 2h PER_BRAND_TIMEOUT_MS kill).
  LEASE_MS: 15 * 60 * 1000,
  HEARTBEAT_MS: 2 * 60 * 1000,
  // Attempts include the first. A job that dies with its box (lease lapse) or errors out is retried by a DIFFERENT box
  // until it has used them up; a 2h timeout is never retried (the same cap would just burn another 2h).
  MAX_ATTEMPTS: 2,
});

/**
 * The queue "night" a moment belongs to: the Eastern calendar date of the most recent 22:00 ET. The fleet's cron fires at
 * 22:00 ET, so the night rolls over exactly at cron time: a core stage that only starts at 21:24 the next evening (after a
 * 23h expansion stage — it happened 2026-10-12) still belongs to the night it continues, instead of seeding a second queue,
 * and a sync that starts at 07:30 belongs to the night that crawled. Calendar arithmetic, not "now minus 22h", so the
 * two DST-change days keep their boundary at 22:00 local.
 */
export function queueNight(now = Date.now()) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(now));
  const get = (t) => Number(parts.find((p) => p.type === t).value);
  const day = Date.UTC(get('year'), get('month') - 1, get('day')) - (get('hour') >= 22 ? 0 : 86_400_000);
  return new Date(day).toISOString().slice(0, 10);
}

/** The Eastern calendar date (what a pilot run files its data under; the nightly queue uses queueNight). */
export function easternDate(now = Date.now()) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(now));
  const g = (t) => parts.find((p) => p.type === t).value;
  return `${g('year')}-${g('month')}-${g('day')}`;
}

export const jobKey = (state, brand) => `${String(state).toUpperCase()}|${brand}`;
export function parseJobKey(key) {
  const i = String(key).indexOf('|');
  return { state: key.slice(0, i), brand: key.slice(i + 1) };
}

const isTerminal = (j) => j.status === JOB.DONE || j.status === JOB.FAILED;

/**
 * Puts every claimed job whose lease has lapsed back in the queue (or marks it failed when it is out of attempts).
 * Pure: returns { jobs, reaped } — the caller persists the changed rows.
 * @param {Array<object>} jobs rows: {jobKey,status,attempts,maxAttempts,leaseExpiresAt,claimedBy,...}
 */
export function reapExpired(jobs, now) {
  const reaped = [];
  const out = jobs.map((j) => {
    if (j.status !== JOB.CLAIMED || j.leaseExpiresAt == null || j.leaseExpiresAt > now) return j;
    const exhausted = j.attempts >= j.maxAttempts;
    const next = {
      ...j,
      status: exhausted ? JOB.FAILED : JOB.QUEUED,
      lastError: `lease expired (no heartbeat from ${j.claimedBy})`,
      lastFailedBox: j.claimedBy,
      claimedBy: null,
      claimToken: null,
      leaseExpiresAt: null,
      finishedAt: exhausted ? now : null,
    };
    reaped.push({ jobKey: j.jobKey, from: j.claimedBy, exhausted });
    return next;
  });
  return { jobs: out, reaped };
}

/**
 * Picks the job a box should run next: the longest estimated job that this box may take (brand set, heavy-heap budget,
 * not one this box already failed). Biggest first is what keeps the tail short — the last jobs left are the small ones.
 * Ties break on job key so the choice is deterministic.
 * @param {{box:string, brandSets?:string[]|null, allowHeavy?:boolean, skipKeys?:string[]}} who
 */
export function pickNext(jobs, who) {
  const skip = new Set(who.skipKeys || []);
  let best = null;
  for (const j of jobs) {
    if (j.status !== JOB.QUEUED) continue;
    if (who.brandSets && who.brandSets.length && !who.brandSets.includes(j.brandSet)) continue;
    if (j.heavy && who.allowHeavy === false) continue;
    if (j.lastFailedBox && j.lastFailedBox === who.box && j.attempts > 0) continue;
    if (skip.has(j.jobKey)) continue;
    if (!best || j.estSeconds > best.estSeconds || (j.estSeconds === best.estSeconds && j.jobKey < best.jobKey)) best = j;
  }
  return best;
}

/** claim: reap, then hand out one job. Returns { jobs, claimed|null, reaped }. */
export function claim(jobs, who, now, { leaseMs = DEFAULTS.LEASE_MS, newToken } = {}) {
  const r = reapExpired(jobs, now);
  const pick = pickNext(r.jobs, who);
  if (!pick) return { jobs: r.jobs, claimed: null, reaped: r.reaped };
  const token = newToken ? newToken() : `${who.box}-${now}-${Math.random().toString(36).slice(2, 8)}`;
  const claimed = {
    ...pick,
    status: JOB.CLAIMED,
    attempts: pick.attempts + 1,
    claimedBy: who.box,
    claimToken: token,
    claimedAt: now,
    startedAt: now,
    heartbeatAt: now,
    leaseExpiresAt: now + leaseMs,
  };
  return { jobs: r.jobs.map((j) => (j.jobKey === pick.jobKey ? claimed : j)), claimed, reaped: r.reaped };
}

/** heartbeat: only the current claim token may renew. A false result tells the worker its lease is gone. */
export function heartbeat(jobs, { jobKey: key, token }, now, { leaseMs = DEFAULTS.LEASE_MS } = {}) {
  const j = jobs.find((x) => x.jobKey === key);
  if (!j || j.status !== JOB.CLAIMED || j.claimToken !== token) return { jobs, renewed: false, reason: !j ? 'unknown job' : j.status !== JOB.CLAIMED ? `job is ${j.status}` : 'claimed by someone else' };
  const next = { ...j, heartbeatAt: now, leaseExpiresAt: now + leaseMs };
  return { jobs: jobs.map((x) => (x.jobKey === key ? next : x)), renewed: true };
}

/**
 * complete / fail. A stale token (the lease was reaped and someone else owns the job now) is rejected so a zombie worker
 * can never mark another box's run done. fail with retryable:false (timeouts) is terminal immediately.
 */
export function finish(jobs, { jobKey: key, token, ok, retryable = true, error = null, durationSeconds = null, exit = null }, now) {
  const j = jobs.find((x) => x.jobKey === key);
  if (!j) return { jobs, accepted: false, reason: 'unknown job' };
  if (j.status !== JOB.CLAIMED || j.claimToken !== token) return { jobs, accepted: false, reason: j.status === JOB.CLAIMED ? 'claimed by someone else' : `job is ${j.status}` };
  let next;
  if (ok) {
    next = { ...j, status: JOB.DONE, finishedAt: now, durationSeconds, exitStatus: exit || 'ok', leaseExpiresAt: null, lastError: null };
  } else if (!retryable || j.attempts >= j.maxAttempts) {
    next = { ...j, status: JOB.FAILED, finishedAt: now, durationSeconds, exitStatus: exit || 'error', leaseExpiresAt: null, lastError: error, lastFailedBox: j.claimedBy };
  } else {
    next = { ...j, status: JOB.QUEUED, claimedBy: null, claimToken: null, leaseExpiresAt: null, durationSeconds, exitStatus: exit || 'error', lastError: error, lastFailedBox: j.claimedBy };
  }
  return { jobs: jobs.map((x) => (x.jobKey === key ? next : x)), accepted: true, status: next.status };
}

/** Counts for the status endpoint / worker "is there anything left that could still come back to me" check. */
export function summarize(jobs) {
  const c = { queued: 0, claimed: 0, done: 0, failed: 0, total: jobs.length };
  for (const j of jobs) c[j.status] = (c[j.status] || 0) + 1;
  c.open = c.queued + c.claimed;
  return c;
}

export { isTerminal };
