// Mutual exclusion around the shared data files every brand process's crawl
// (src/standalone.js) and enrichment pass (src/enricher.js) reads and
// rewrites. As of the state-sharding fix (see inventory_shards.js), most of
// these are no longer nationwide-shared at all: data/inventory/<state>.json,
// data/snapshots/<state>.json, and data/enriched_cache/<state>.json are each
// touched only by that one state's own brand-runs, so the lock is now keyed
// by `scope` — pass a state code (e.g. "NJ") for those, so two different
// states' brand-runs never even attempt to take the same lock file. The one
// file that's still genuinely nationwide-shared is
// data/daily_changes/daily_changes_<date>.json (every state's brands append
// their own slot into the SAME date's file) — callers scope that one by
// date instead (e.g. "daily-changes-2026-09-20").
//
// Why this exists: run-daily-crawl.mjs used to run one state's entire
// brand loop to completion before starting the next state, so no two
// brand processes ever touched these files at the same time — each one's
// own read-modify-write (see inventory_merge.js / daily_changes.js for the
// "modify" half, which is already correctly scoped to that run's own
// dealers) never overlapped another's. Once the driver runs
// MAX_CONCURRENT_STATES states' brand loops concurrently, that stops being
// true: two brand processes can both read one of these files, both compute
// their own (individually correct) update, and then write back — whichever
// write lands second silently discards everything the first one added, even
// though neither process's own logic was wrong. That's a classic
// lost-update race, not a bug in the merge logic itself.
//
// Why a lock (over per-run staging + a final sequential merge pass): the
// actual state-level parallelism win only requires the crawling and
// enrichment (which dominate a run's wall-clock time) to overlap — the
// shared-file update itself is a few JSON parses and a few writes, seconds
// at most even for a large cumulative file. A lock held only around that
// brief section keeps the expensive work fully parallel and leaves the
// existing (already-fixed, already-tested) merge functions completely
// unchanged; it just wraps their read and write in a critical section. A
// staging-plus-merge design would need a second full pass over every
// concurrent run's output and a place to put it, for no extra safety here.
//
// Why not proper-lockfile (or another npm lock package): not already a
// dependency, and this crawler runs unattended on a 2-vCPU box where adding
// a new dependency (and whatever transitively comes with it) isn't free.
// The actual requirement — exclusive access, safe reclaim if the holder
// crashed — is small enough to implement directly on top of the same
// PID-liveness check (src/pid_lock.js#isProcessAlive) the driver's own
// overlap guard (scripts/run-daily-crawl.mjs#acquireLock) already uses and
// already has tests proving it reclaims correctly after a crash. This is
// that same lesson applied to a much shorter, much more frequently
// contended critical section, not a new fragile lock invented from scratch.
//
// Atomicity: acquiring the lock uses `fs.open(lockPath, 'wx')` — an
// exclusive create that atomically fails with EEXIST if the file already
// exists. That's the one step here that has to be race-free at the OS
// level; everything else (reading the existing lock's PID/age to decide
// whether it's stale, then retrying) is just deciding whether to attempt
// another atomic create, so two processes racing to reclaim the same stale
// lock always converge on exactly one winner instead of both believing they
// hold it.

import fs from 'node:fs/promises';
import path from 'node:path';
import { isProcessAlive } from './pid_lock.js';

// The critical section this guards is a handful of JSON reads/writes, not
// a crawl — anything still holding the lock after this long is a crashed or
// hung process, not a legitimately slow update, so it's always safe to
// reclaim. This is deliberately finite (unlike the whole-driver-invocation
// lock in run-daily-crawl.mjs, which has to survive a run that legitimately
// takes hours).
export const DEFAULT_STALE_AFTER_MS = 10 * 60 * 1000; // 10 minutes
// How long a caller will wait/retry for a contended lock before giving up.
// Generous relative to the expected hold time (seconds) so ordinary
// contention between two concurrent states never trips it, while still
// failing loudly instead of hanging forever if something is genuinely wrong.
export const DEFAULT_MAX_WAIT_MS = 5 * 60 * 1000; // 5 minutes
export const DEFAULT_RETRY_DELAY_MS = 200;

// `scope` is required: every real call site now has one (a state code, or a
// "daily-changes-<date>" key for the one still-nationwide file — see the
// header comment above). There's deliberately no unscoped fallback to a
// single global lock file — that global file is exactly the bottleneck this
// scoping fixes, so a caller that forgot to scope itself should fail loudly
// here rather than silently serializing against every other state again.
export function sharedDataLockPath(cwd = process.cwd(), scope) {
  if (!scope) {
    throw new Error(
      'sharedDataLockPath requires a scope (a state code like "NJ", or "daily-changes-<date>" '
      + 'for the shared daily-changes file) — pass one explicitly, or pass lockPath directly instead.',
    );
  }
  return path.join(path.resolve(cwd, 'data'), 'locks', `${scope}.lock`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Atomic: succeeds (and the lock is ours) iff the file did not already
// exist. Never throws for the expected "someone else holds it" case.
async function tryCreateLockFile(lockPath, payload) {
  await fs.mkdir(path.dirname(lockPath), { recursive: true });
  let handle;
  try {
    handle = await fs.open(lockPath, 'wx');
  } catch (err) {
    if (err.code === 'EEXIST') return false;
    throw err;
  }
  try {
    await handle.writeFile(JSON.stringify(payload));
  } finally {
    await handle.close();
  }
  return true;
}

// Best-effort: if the current holder is dead or has held it implausibly
// long, remove the file so the next create attempt (ours or a competitor's
// — doesn't matter which) can succeed. Never throws: a read/unlink racing
// with the real holder releasing it right now is just a no-op, not an error.
async function reclaimIfStale(lockPath, staleAfterMs, now) {
  let existing;
  try {
    existing = JSON.parse(await fs.readFile(lockPath, 'utf-8'));
  } catch {
    return; // gone already (released concurrently) or unreadable — either way, nothing to reclaim
  }
  const startedMs = Date.parse(existing?.startedAt || '');
  const age = Number.isFinite(startedMs) ? now - startedMs : Infinity;
  const holderDead = typeof existing?.pid !== 'number' || !isProcessAlive(existing.pid);
  const tooOld = Number.isFinite(staleAfterMs) && age > staleAfterMs;
  if (holderDead || tooOld) {
    await fs.rm(lockPath, { force: true }).catch(() => {});
  }
}

// Acquires the shared-data lock, retrying with a short delay while it's
// held by a still-alive, not-yet-stale process. Throws (rather than hanging
// forever) if `maxWaitMs` elapses first — the caller (standalone.js /
// enricher.js) is expected to let that propagate up through its existing
// per-brand try/catch, exactly like any other failure of that one brand's
// run, so it can never take down a concurrently-running other state.
export async function acquireSharedDataLock({
  lockPath,
  scope,
  cwd,
  pid = process.pid,
  label = null,
  staleAfterMs = DEFAULT_STALE_AFTER_MS,
  maxWaitMs = DEFAULT_MAX_WAIT_MS,
  retryDelayMs = DEFAULT_RETRY_DELAY_MS,
} = {}) {
  const resolvedLockPath = lockPath || sharedDataLockPath(cwd, scope);
  const payload = { pid, label, startedAt: new Date().toISOString() };
  const deadline = Date.now() + maxWaitMs;
  for (;;) {
    if (await tryCreateLockFile(resolvedLockPath, payload)) {
      return {
        lockPath: resolvedLockPath,
        pid,
        release: () => releaseSharedDataLock({ lockPath: resolvedLockPath, pid }),
      };
    }
    if (Date.now() >= deadline) {
      let holder = null;
      try {
        holder = JSON.parse(await fs.readFile(resolvedLockPath, 'utf-8'));
      } catch {
        // fall through with holder still null
      }
      throw new Error(
        `Timed out after ${maxWaitMs}ms waiting for the shared-data lock at ${resolvedLockPath}`
        + (label ? ` (wanted by ${label})` : '')
        + (holder ? ` — currently held by pid ${holder.pid}, started ${holder.startedAt}${holder.label ? ` (${holder.label})` : ''}` : ''),
      );
    }
    await reclaimIfStale(resolvedLockPath, staleAfterMs, Date.now());
    await sleep(retryDelayMs);
  }
}

// Releases the lock, but only if it still looks like ours — guards against
// a slow caller releasing a lock that a stale-reclaim already handed to a
// different process in the meantime. Never throws: safe in a `finally`.
export async function releaseSharedDataLock({ lockPath, scope, cwd, pid = process.pid } = {}) {
  const resolvedLockPath = lockPath || sharedDataLockPath(cwd, scope);
  try {
    const existing = JSON.parse(await fs.readFile(resolvedLockPath, 'utf-8'));
    if (existing?.pid !== pid) return;
  } catch {
    return;
  }
  await fs.rm(resolvedLockPath, { force: true }).catch(() => {});
}

// Convenience wrapper: acquire, run fn(), always release — even if fn()
// throws. This is the shape every real call site (standalone.js's merge +
// write, enricher.js's cache/inventory write) actually uses.
export async function withSharedDataLock(fn, opts = {}) {
  const lock = await acquireSharedDataLock(opts);
  try {
    return await fn();
  } finally {
    await lock.release();
  }
}
