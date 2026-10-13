// The crawl box's side of the queue: N slots, each looping claim -> run -> report, until the queue is drained or the
// night's budget is spent. All I/O is injected (client, runJob, clock), so the tests drive it with fakes.
//
// Safety properties this loop is responsible for:
//   - a lease is renewed every HEARTBEAT_MS while the job runs; if the server says the lease is gone (the box was presumed
//     dead and the job handed to another box), the result is DISCARDED — never reported, never put in the sync manifest;
//   - a result is reported with the claim token, so a zombie can't complete someone else's claim;
//   - a transient API error never kills the loop (backoff, bounded) and never turns into a retry of a finished crawl;
//   - this worker never starts a job after the budget deadline, and never kills one already running (the per-shard 2h kill
//     in the driver is what bounds a running job).
import { DEFAULTS } from './crawlQueueCore.js';

const sleepDefault = (ms) => new Promise((r) => setTimeout(r, ms));

export async function runWorker({
  client, flag, night, runJob, onFinished = async () => {}, log = console.log, now = Date.now, sleep = sleepDefault,
  deadlineMs = null, startedAt = now(), pollMs = 60_000, heartbeatMs = DEFAULTS.HEARTBEAT_MS, maxApiFailures = 20, idlePollsBeforeExit = 10,
  // Once nothing is queued and only other boxes' jobs are running, stay this long in case one of them dies and its lease
  // lapses (this box can then pick the shard up), then leave so the box can sync what it finished instead of waiting out the
  // whole fleet. Peers that are still working recover each other's orphans on their own next claim.
  standbyMs = 20 * 60_000,
}) {
  const results = [];
  let heavyRunning = 0;
  let running = 0;
  let heavyReserved = 0; // slots in the middle of a claim that is allowed to return a heavy shard (several slots claim at once)
  let apiFailures = 0;
  const outOfTime = () => deadlineMs != null && now() - startedAt >= deadlineMs;

  // Retried a few times: if every attempt fails the lease simply lapses and the job is re-run elsewhere — wasteful, never wrong.
  async function report(fn) {
    let last;
    for (let i = 0; i < 5; i++) {
      try { return await fn(); } catch (e) { last = e; if (e.retryable === false) break; await sleep(Math.min(30_000, 2000 * 2 ** i)); }
    }
    throw last;
  }

  async function slotLoop(slot) {
    let idle = 0;
    for (;;) {
      if (outOfTime()) { log(`[queue] slot ${slot}: night budget spent — not starting more jobs`); return; }
      let c;
      // Reserve the heavy allowance BEFORE asking: with 3 slots claiming at the same instant, "running < max" read by each of
      // them would all be true and the box would end up with 3 heavy (multi-GB heap) crawls at once.
      const mayTakeHeavy = heavyRunning + heavyReserved < flag.maxHeavy;
      if (mayTakeHeavy) heavyReserved++;
      try {
        c = await client.claim({ night, brandSets: flag.brandSets, allowHeavy: mayTakeHeavy });
        apiFailures = 0;
        if (mayTakeHeavy) { heavyReserved--; if (c.claimed && c.claimed.heavy) heavyRunning++; }
      } catch (e) {
        if (mayTakeHeavy) heavyReserved--;
        apiFailures++;
        log(`[queue] slot ${slot}: claim failed (${e.message}) [${apiFailures}/${maxApiFailures}]`);
        if (apiFailures >= maxApiFailures) { log('[queue] too many API failures in a row — this box stops claiming; unfinished jobs go back to the queue when their leases lapse'); return; }
        await sleep(Math.min(120_000, 5000 * apiFailures));
        continue;
      }
      if (!c.claimed) {
        const open = c.counts?.open ?? 0;
        if (open === 0) { log(`[queue] slot ${slot}: queue drained`); return; }
        idle++;
        if ((c.counts?.queued ?? 0) === 0) {
          // only other boxes' running jobs remain
          if (idle * pollMs >= standbyMs) { log(`[queue] slot ${slot}: only other boxes' running jobs remain — leaving so this box can sync what it finished`); return; }
        } else if (running === 0 && idle >= idlePollsBeforeExit) {
          // queued work exists but this box may not take any of it, and has nothing of its own that could free a slot
          log(`[queue] slot ${slot}: ${c.counts.queued} job(s) remain that this box may not take — exiting`);
          return;
        }
        await sleep(pollMs);
        continue;
      }
      idle = 0;
      const job = c.claimed;
      if (c.reaped?.length) log(`[queue] reclaimed ${c.reaped.length} expired lease(s): ${c.reaped.map((r) => `${r.jobKey} (from ${r.from}${r.exhausted ? ', out of attempts' : ''})`).join(', ')}`);
      running++;
      log(`[queue] slot ${slot}: claimed ${job.jobKey} (attempt ${job.attempt}, est ${Math.round(job.estSeconds / 60)} min, ${job.dealers} dealers)`);
      let leaseLost = false;
      const hb = setInterval(async () => {
        try { const r = await client.heartbeat({ night, jobKey: job.jobKey, token: job.token }); if (!r.renewed) { leaseLost = true; log(`[queue] ${job.jobKey}: lease LOST (${r.reason}) — result will be discarded`); } } catch { /* a missed beat is fine; 15 min of lease covers many */ }
      }, heartbeatMs);
      const t0 = now();
      let res;
      try { res = await runJob(job, { isLeaseLost: () => leaseLost }); } catch (e) { res = { ok: false, retryable: true, error: `runner threw: ${e.message}`, exit: 'error' }; }
      clearInterval(hb);
      running--;
      if (job.heavy) heavyRunning--;
      const durationSeconds = Math.round((now() - t0) / 1000);
      if (leaseLost) { results.push({ jobKey: job.jobKey, outcome: 'lease-lost' }); continue; }
      try {
        if (res.ok) {
          const r = await report(() => client.complete({ night, jobKey: job.jobKey, token: job.token, durationSeconds, exit: res.exit || 'ok', vehicles: res.vehicles ?? null }));
          if (r.accepted) { await onFinished(job, { ...res, durationSeconds, startedAt: t0 }); results.push({ jobKey: job.jobKey, outcome: res.skipped ? 'skipped' : 'done', durationSeconds }); }
          else { log(`[queue] ${job.jobKey}: completion rejected (${r.reason}) — result discarded`); results.push({ jobKey: job.jobKey, outcome: 'rejected' }); }
        } else {
          const r = await report(() => client.fail({ night, jobKey: job.jobKey, token: job.token, error: res.error, retryable: res.retryable !== false, durationSeconds, exit: res.exit || 'error' }));
          log(`[queue] ${job.jobKey}: failed (${res.exit || 'error'}: ${String(res.error).slice(0, 160)}) -> ${r.status || 'recorded'}`);
          results.push({ jobKey: job.jobKey, outcome: 'failed', status: r.status });
        }
      } catch (e) {
        log(`[queue] ${job.jobKey}: could not report the result (${e.message}); its lease will lapse and the job is re-run elsewhere`);
        results.push({ jobKey: job.jobKey, outcome: 'unreported' });
      }
    }
  }

  await Promise.all(Array.from({ length: flag.slots }, (_, i) => slotLoop(i + 1)));
  return results;
}
