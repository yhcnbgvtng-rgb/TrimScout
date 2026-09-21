// Shared primitive behind every PID-based lock in this crawler.
//
// Extracted from scripts/run-daily-crawl.mjs's acquireLock()/isProcessAlive()
// (the driver-overlap guard, added to stop a second cron-fired invocation of
// the whole driver from running concurrently against the shared data files)
// so the same "is the PID that wrote this lock file actually still alive"
// check can be reused by shared_data_lock.js below — that lock guards a much
// shorter, much more frequently contended critical section (one brand
// process's read-modify-write of the shared inventory/changes files), not
// the whole-driver-invocation lock, but the failure mode it has to survive
// is identical: a process that crashed or was killed while holding the lock
// must never leave every future run permanently blocked.
export function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM means the PID exists but is owned by another user (still
    // alive). ESRCH (the common case for a stale lock left by a
    // crashed/killed process) means it is not.
    return err.code === 'EPERM';
  }
}
