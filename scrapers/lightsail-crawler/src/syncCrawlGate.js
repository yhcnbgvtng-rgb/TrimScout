// Pure decision logic behind "is a crawl for this box still running, so the inventory sync must
// not start yet" — extracted so it's unit-testable without real lock files, a real pgrep, or a
// real crawl process.
//
// Root cause fixed 2026-09-30: box4's 07:45 ET sync checked only one hardcoded lock file,
// driver.lock, and found it clear — correctly, since box4's 23:00 EXPANSION crawl had already
// finished and released it. But box4 also runs a SEPARATE 04:00 CORE crawl
// (CRAWLER_RUN_LABEL=core), which writes a DIFFERENT file, driver-core.lock (see LOCK_PATH in
// run-daily-crawl.mjs — the filename is `driver-${CRAWLER_RUN_LABEL}.lock` whenever that env var
// is set). That core crawl (PID 27873) was still 9+ hours into FL when the sync started, swept,
// and completed against a not-yet-finished crawl output. Confirmed live: driver-core.lock held
// PID 27873 continuously from the crawl's start to its actual exit — the lock itself was never
// released early; the sync was just never looking at it. (A later manual resync already fixed
// the resulting data gap — this fix is about tonight's recurrence, not tonight's data.)
//
// This function is given every driver*.lock file already found on disk (so it generalizes to
// any current or future CRAWLER_RUN_LABEL, not just 'core') AND an independent, direct
// crawl-process check — a lock file could in principle go missing (deleted by hand, a bug, a
// crash mid-write) while the process it represents is still alive; "a clear lock file alone is
// not enough" per the requirement this closes.
export function evaluateCrawlGate({ lockEntries, crawlProcessPid, isPidAlive }) {
  for (const entry of lockEntries) {
    if (entry.pid != null && isPidAlive(entry.pid)) {
      return { busy: true, reason: `lock ${entry.name} held by pid ${entry.pid}` };
    }
  }
  if (crawlProcessPid != null && isPidAlive(crawlProcessPid)) {
    return { busy: true, reason: `crawl process pid ${crawlProcessPid} alive (no matching lock file)` };
  }
  return { busy: false, reason: null };
}
