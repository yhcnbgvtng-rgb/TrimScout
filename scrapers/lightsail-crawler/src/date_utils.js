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
