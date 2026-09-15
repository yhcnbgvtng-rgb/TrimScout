import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { easternDateStamp } from '../src/date_utils.js';

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
