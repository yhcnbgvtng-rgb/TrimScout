import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { easternDateStamp, resolveRunDate } from '../src/date_utils.js';

// ---------------------------------------------------------------------
// Root cause this covers: Node's Date.toISOString() always returns a UTC
// instant regardless of the process's TZ env var, so the common
// `new Date().toISOString().slice(0,10)` idiom silently buckets by the
// UTC calendar date. The nightly cron fires on Eastern wall-clock time,
// but a run near either midnight (UTC or Eastern — they're never the
// same moment) can land on the wrong side of one of them, filing a run
// under the wrong day.
// ---------------------------------------------------------------------
describe('easternDateStamp (Eastern-calendar-date bucketing)', () => {
  it('returns the Eastern calendar date, not the UTC one, when they differ (late evening ET, already past UTC midnight the next day)', () => {
    // 2026-09-14 23:30 America/New_York (EDT, UTC-4) is 2026-09-15 03:30 UTC.
    // A naive new Date(instant).toISOString().slice(0,10) would say
    // "2026-09-15" — tomorrow's UTC date — even though it's still
    // 2026-09-14 evening on the Eastern calendar.
    const instant = new Date('2026-09-15T03:30:00.000Z');
    assert.equal(instant.toISOString().slice(0, 10), '2026-09-15'); // the naive/buggy answer
    assert.equal(easternDateStamp(instant), '2026-09-14'); // the correct Eastern answer
  });

  it('returns the Eastern calendar date, not the UTC one, when the run is early morning ET but still the previous UTC day\'s tail', () => {
    // 2026-01-15 00:30 America/New_York (EST, UTC-5) is 2026-01-15 05:30 UTC —
    // both calendars already agree here, so also cover the inverse boundary:
    // 2026-01-14 23:30 America/New_York (EST) is 2026-01-15 04:30 UTC. Same
    // shape as the first case but during standard time (no DST), proving
    // this isn't relying on a fixed UTC-4/UTC-5 offset assumption.
    const instant = new Date('2026-01-15T04:30:00.000Z');
    assert.equal(instant.toISOString().slice(0, 10), '2026-01-15');
    assert.equal(easternDateStamp(instant), '2026-01-14');
  });

  it('defaults to now when called with no argument', () => {
    const stamp = easternDateStamp();
    assert.match(stamp, /^\d{4}-\d{2}-\d{2}$/);
  });

  it('formats as zero-padded YYYY-MM-DD for single-digit months/days', () => {
    // 2026-03-05 12:00 UTC is still 2026-03-05 morning in America/New_York.
    assert.equal(easternDateStamp(new Date('2026-03-05T12:00:00.000Z')), '2026-03-05');
  });
});

// ---------------------------------------------------------------------
// resolveRunDate: the fix for the midnight-crossing daily_changes
// ledger-split bug. run-daily-crawl.mjs computes ONE canonical date once
// at the start of a run and threads it through every state/brand, but
// each brand runs in its own standalone.js subprocess spawned whenever
// the driver gets around to it — not necessarily the same wall-clock
// moment the driver itself started. Confirmed live 2026-09-16: a run
// starting ~9pm ET with FL and TX still crawling past midnight ET saw 11
// of 61 brand-runs compute the *next* day's date instead of the run's
// actual date, filing into a freshly-created daily_changes_<next-date>
// .json instead of merging into the correct file.
//
// The fix threads the driver's canonical date down via the CRAWLER_
// RUN_DATE env var; standalone.js's todayDate now comes from
// resolveRunDate() instead of calling easternDateStamp() directly.
// ---------------------------------------------------------------------
describe('resolveRunDate (per-brand-subprocess run-date inheritance)', () => {
  it('uses CRAWLER_RUN_DATE when set, even though the wall clock has already crossed into the next Eastern calendar day — the actual midnight-crossing bug', () => {
    // The driver started at ~9pm ET on 2026-09-15 and computed canonical
    // date 2026-09-15. This brand's own subprocess doesn't get spawned
    // until after Eastern midnight — wall-clock "now" for THIS subprocess
    // is already 2026-09-16.
    const wallClockAfterMidnight = new Date('2026-09-16T04:30:00.000Z'); // 2026-09-16 00:30 ET (EDT, UTC-4)
    // Confirms this scenario actually exercises the bug: computing fresh
    // from "now" (the old, buggy behavior) would give a DIFFERENT date
    // than the driver's canonical one.
    assert.equal(easternDateStamp(wallClockAfterMidnight), '2026-09-16');

    const resolved = resolveRunDate({ env: { CRAWLER_RUN_DATE: '2026-09-15' }, now: wallClockAfterMidnight });
    assert.equal(resolved, '2026-09-15', 'must use the driver\'s canonical date, not the date fresh-computed from this subprocess\'s own wall clock');
  });

  it('falls back to computing the Eastern date fresh from "now" when CRAWLER_RUN_DATE is not set (manual/ad hoc standalone.js invocation)', () => {
    // Every prior state rollout has sample-tested new state data by
    // running `node src/standalone.js` directly from a worktree, with no
    // driver and no CRAWLER_RUN_DATE — that path must keep working
    // exactly as it does today.
    const now = new Date('2026-09-16T04:30:00.000Z');
    assert.equal(resolveRunDate({ env: {}, now }), '2026-09-16');
  });

  it('ignores a malformed CRAWLER_RUN_DATE and falls back to computing fresh instead of filing under garbage', () => {
    const now = new Date('2026-09-16T04:30:00.000Z');
    assert.equal(resolveRunDate({ env: { CRAWLER_RUN_DATE: 'not-a-date' }, now }), '2026-09-16');
    assert.equal(resolveRunDate({ env: { CRAWLER_RUN_DATE: '' }, now }), '2026-09-16');
  });

  it('defaults env to process.env and now to the real current time when called with no arguments', () => {
    const stamp = resolveRunDate();
    assert.match(stamp, /^\d{4}-\d{2}-\d{2}$/);
  });
});
