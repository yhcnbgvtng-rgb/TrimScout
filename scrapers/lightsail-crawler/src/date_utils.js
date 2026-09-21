// Eastern-calendar-date helper.
//
// Node's `Date.toISOString()` always returns a UTC instant regardless of
// the process's `TZ` env var, so the common `new Date().toISOString().slice(0,10)`
// idiom silently buckets by the *UTC* calendar date. The nightly cron fires
// on Eastern wall-clock time (`TZ=America/New_York`), but that only affects
// when the process starts — every date computed inside it with that idiom
// still uses UTC. For a "daily" pipeline whose files are named/bucketed by
// calendar day (`daily_changes_<date>.json`, `dealer-bot-report-<state>-*-<date>.json`,
// per-brand log files, firstSeen/lastSeen/soldDate on vehicle records, DOM
// snapshot retention), that's a real bug: a run anywhere near UTC midnight
// (which is 8pm/7pm Eastern depending on DST) or near Eastern midnight can
// file itself under the wrong side of midnight for either calendar — and
// this gets worse the earlier in the evening (Eastern) the cron starts.
//
// Use `easternDateStamp()` for any *calendar-date* bucketing decision —
// "which day is this run's data filed under", day-over-day comparisons,
// retention cutoffs, filenames. Do NOT use it for precise instants (exact
// wall-clock moments like `submittedAt`/`generatedAt`/`collectedAt`/
// `startedAt`/`endedAt`) — those should stay real UTC ISO instants via
// `new Date().toISOString()`. This helper only changes which *calendar
// day* a moment is said to belong to, never how precisely a moment itself
// is recorded.
const EASTERN_TZ = 'America/New_York';

// en-CA formats as YYYY-MM-DD directly (no manual component reassembly),
// and DST is handled by the IANA `America/New_York` zone itself, not a
// fixed UTC offset — this is correct year-round, including on the days
// DST actually changes.
const easternDateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: EASTERN_TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

// Returns the Eastern calendar date (YYYY-MM-DD) that `date` (an instant;
// defaults to now) falls on.
export function easternDateStamp(date = new Date()) {
  return easternDateFormatter.format(date);
}

const RUN_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Resolves the single calendar date a crawl run should file its data
// under (daily_changes filename, firstSeen/lastSeen/soldDate, DOM-blob
// retention — everything easternDateStamp() itself is used for).
//
// Root cause this fixes: run-daily-crawl.mjs computes ONE canonical
// business date (via easternDateStamp()) once at the start of a run, but
// each brand it crawls runs in its own standalone.js subprocess, spawned
// at whatever wall-clock moment the driver happens to get around to that
// brand — not necessarily the same moment the driver itself started. A
// run spanning Eastern midnight (confirmed live: a 9pm ET start with FL
// and TX still crawling past midnight) used to let brands that started
// after midnight silently compute a DIFFERENT calendar date than brands
// that started before it, splitting one business day's daily_changes
// ledger across two files.
//
// Fix: the driver passes its canonical date down to every brand
// subprocess as CRAWLER_RUN_DATE (YYYY-MM-DD, Eastern). standalone.js
// calls this instead of easternDateStamp() directly, so every brand in a
// driver-launched run agrees on the same date regardless of when its own
// subprocess happened to start. Falls back to computing the Eastern date
// fresh (the pre-fix behavior) when CRAWLER_RUN_DATE is unset or
// malformed — this is what a manual/ad hoc `node src/standalone.js`
// invocation (run directly from a terminal, not via the driver — the
// habit every prior state-rollout used to sample-test new data) still
// needs and must keep working unchanged.
export function resolveRunDate({ env = process.env, now = new Date() } = {}) {
  const override = env.CRAWLER_RUN_DATE;
  if (override && RUN_DATE_RE.test(override)) {
    return override;
  }
  return easternDateStamp(now);
}
