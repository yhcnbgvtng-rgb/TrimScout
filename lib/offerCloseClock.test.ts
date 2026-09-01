import "./testdata/blockLiveHttp";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { dateKey, observedFederalHolidays, observedDate } from "./usFederalHolidays";
import { timeZoneForUsState } from "./usTimeZones";
import {
  elapsedRunningMs,
  evaluateOfferClock,
  instantWhenRunningElapsed,
  OFFER_CLOCK_EXTEND_MS,
  OFFER_CLOCK_RUNNING_MS,
  pauseReasonAt,
  zonedLocalToUtc,
} from "./offerCloseClock";

const NJ = "America/New_York";

function et(year: number, month: number, day: number, hour: number, minute = 0): Date {
  return zonedLocalToUtc(NJ, year, month, day, hour, minute);
}

describe("US federal holidays are a date function, not a year hardcode", () => {
  it("observes weekend holidays onto Friday or Monday", () => {
    // Jan 1 2022 was Saturday → observed Friday Dec 31 2021
    assert.deepEqual(observedDate({ year: 2022, month: 1, day: 1 }), { year: 2021, month: 12, day: 31 });
    // Jul 4 2026 is Saturday → Friday Jul 3
    assert.deepEqual(observedDate({ year: 2026, month: 7, day: 4 }), { year: 2026, month: 7, day: 3 });
    // Dec 25 2022 was Sunday → Monday Dec 26
    assert.deepEqual(observedDate({ year: 2022, month: 12, day: 25 }), { year: 2022, month: 12, day: 26 });
  });

  it("returns the 11 federal holidays for an arbitrary year", () => {
    const keys = observedFederalHolidays(2026).map(dateKey);
    assert.equal(keys.length, 11);
    assert.ok(keys.includes("2026-01-01")); // NYD Thursday
    assert.ok(keys.includes("2026-01-19")); // MLK
    assert.ok(keys.includes("2026-02-16")); // Presidents
    assert.ok(keys.includes("2026-05-25")); // Memorial
    assert.ok(keys.includes("2026-06-19")); // Juneteenth
    assert.ok(keys.includes("2026-07-03")); // Independence observed (Sat 4th)
    assert.ok(keys.includes("2026-09-07")); // Labor
    assert.ok(keys.includes("2026-10-12")); // Columbus / Indigenous Peoples'
    assert.ok(keys.includes("2026-11-11")); // Veterans
    assert.ok(keys.includes("2026-11-26")); // Thanksgiving
    assert.ok(keys.includes("2026-12-25")); // Christmas Friday
  });
});

describe("primary dealership timezone", () => {
  it("maps NJ to America/New_York and unknown to the same default", () => {
    assert.equal(timeZoneForUsState("NJ"), NJ);
    assert.equal(timeZoneForUsState("nj"), NJ);
    assert.equal(timeZoneForUsState(""), NJ);
    assert.equal(timeZoneForUsState(undefined), NJ);
    assert.equal(timeZoneForUsState("ZZ"), NJ);
    assert.equal(timeZoneForUsState("CA"), "America/Los_Angeles");
  });
});

describe("offer-close clock — idle until first view", () => {
  it("stays idle with full 48h remaining when no dealer has viewed", () => {
    const snap = evaluateOfferClock({
      startedAt: null,
      now: et(2026, 6, 10, 10, 0),
      timeZone: NJ,
    });
    assert.equal(snap.status, "idle");
    assert.equal(snap.remainingMs, OFFER_CLOCK_RUNNING_MS);
    assert.equal(snap.paused, false);
    assert.equal(snap.startedAt, null);
  });
});

describe("offer-close clock — NJ dealer weekday running time", () => {
  it("burns 48 running hours on a mid-week stretch with no pause", () => {
    // Wednesday 10:00 June 10 2026 → Thursday 10:00 June 11 is 24 running hours
    const start = et(2026, 6, 10, 10, 0);
    const plus24 = et(2026, 6, 11, 10, 0);
    assert.equal(elapsedRunningMs(start.getTime(), plus24.getTime(), NJ), 24 * 3600 * 1000);

    const snap = evaluateOfferClock({
      startedAt: start,
      now: plus24,
      timeZone: NJ,
    });
    assert.equal(snap.status, "running");
    assert.equal(snap.remainingMs, 24 * 3600 * 1000);
    assert.equal(snap.pauseReason, null);

    const closeAt = instantWhenRunningElapsed(start.getTime(), OFFER_CLOCK_RUNNING_MS, NJ);
    assert.equal(closeAt, et(2026, 6, 12, 10, 0).getTime());
  });
});

describe("offer-close clock — weekend pause Saturday 18:00 to Monday 09:00 ET", () => {
  it("pauses Saturday evening and resumes Monday morning for an NJ dealer", () => {
    const start = et(2026, 6, 12, 10, 0); // Friday 10:00
    const satNoon = et(2026, 6, 13, 12, 0);
    const satEve = et(2026, 6, 13, 18, 0);
    const sunday = et(2026, 6, 14, 12, 0);
    const monMorning = et(2026, 6, 15, 8, 59);
    const monOpen = et(2026, 6, 15, 9, 0);

    assert.equal(pauseReasonAt(satNoon.getTime(), NJ), null);
    assert.equal(pauseReasonAt(satEve.getTime(), NJ), "weekend");
    assert.equal(pauseReasonAt(sunday.getTime(), NJ), "weekend");
    assert.equal(pauseReasonAt(monMorning.getTime(), NJ), "weekend");
    assert.equal(pauseReasonAt(monOpen.getTime(), NJ), null);

    // Fri 10:00 → Sat 18:00 = 32 running hours
    assert.equal(elapsedRunningMs(start.getTime(), satEve.getTime(), NJ), 32 * 3600 * 1000);
    // Pause does not burn running time
    assert.equal(elapsedRunningMs(start.getTime(), monOpen.getTime(), NJ), 32 * 3600 * 1000);

    const paused = evaluateOfferClock({ startedAt: start, now: sunday, timeZone: NJ });
    assert.equal(paused.status, "paused");
    assert.equal(paused.pauseReason, "weekend");
    assert.equal(paused.remainingMs, (48 - 32) * 3600 * 1000);
    assert.equal(paused.resumeAt, monOpen.toISOString());

    const runningAgain = evaluateOfferClock({ startedAt: start, now: monOpen, timeZone: NJ });
    assert.equal(runningAgain.status, "running");
    assert.equal(runningAgain.remainingMs, 16 * 3600 * 1000);
  });
});

describe("offer-close clock — holiday-adjacent Friday and Monday", () => {
  it("Friday Independence Day 2025 pauses Thursday 19:00 and resumes Monday 09:00", () => {
    // July 4 2025 is Friday. Pause Thu Jul 3 19:00, resume Mon Jul 7 09:00.
    const thuAfternoon = et(2025, 7, 3, 18, 0);
    const thuEve = et(2025, 7, 3, 19, 0);
    const friday = et(2025, 7, 4, 12, 0);
    const sunday = et(2025, 7, 6, 12, 0);
    const mondayOpen = et(2025, 7, 7, 9, 0);

    assert.equal(pauseReasonAt(thuAfternoon.getTime(), NJ), null);
    assert.equal(pauseReasonAt(thuEve.getTime(), NJ), "holiday");
    assert.ok(["holiday", "weekend_and_holiday"].includes(pauseReasonAt(friday.getTime(), NJ) || ""));
    assert.ok(["weekend", "weekend_and_holiday"].includes(pauseReasonAt(sunday.getTime(), NJ) || ""));
    assert.equal(pauseReasonAt(mondayOpen.getTime(), NJ), null);

    const start = et(2025, 7, 3, 10, 0); // Thursday 10:00 — 9h until pause
    const paused = evaluateOfferClock({ startedAt: start, now: friday, timeZone: NJ });
    assert.equal(paused.status, "paused");
    assert.equal(paused.remainingMs, (48 - 9) * 3600 * 1000);
    assert.equal(paused.resumeAt, mondayOpen.toISOString());

    const resumed = evaluateOfferClock({ startedAt: start, now: mondayOpen, timeZone: NJ });
    assert.equal(resumed.status, "running");
    assert.equal(resumed.remainingMs, 39 * 3600 * 1000);
  });

  it("Monday MLK 2026 composes weekend + holiday: pause Sat 18:00, resume Tuesday 09:00", () => {
    // MLK 2026 is Monday Jan 19. Weekend pause Sat Jan 17 18:00–Mon 09:00
    // Holiday pause Sun Jan 18 19:00–Tue Jan 20 09:00 → composed Sat 18:00–Tue 09:00
    const satAfternoon = et(2026, 1, 17, 17, 0);
    const satEve = et(2026, 1, 17, 18, 0);
    const mondayHoliday = et(2026, 1, 19, 10, 0);
    const tueOpen = et(2026, 1, 20, 9, 0);

    assert.equal(pauseReasonAt(satAfternoon.getTime(), NJ), null);
    assert.equal(pauseReasonAt(satEve.getTime(), NJ), "weekend");
    assert.ok(["holiday", "weekend_and_holiday"].includes(pauseReasonAt(mondayHoliday.getTime(), NJ) || ""));
    assert.equal(pauseReasonAt(tueOpen.getTime(), NJ), null);

    const start = et(2026, 1, 16, 10, 0); // Friday 10:00
    const pausedMon = evaluateOfferClock({ startedAt: start, now: mondayHoliday, timeZone: NJ });
    assert.equal(pausedMon.status, "paused");
    assert.equal(pausedMon.resumeAt, tueOpen.toISOString());
    // Fri 10:00 → Sat 18:00 = 32 running hours
    assert.equal(pausedMon.remainingMs, 16 * 3600 * 1000);

    const resumed = evaluateOfferClock({ startedAt: start, now: tueOpen, timeZone: NJ });
    assert.equal(resumed.status, "running");
    assert.equal(resumed.remainingMs, 16 * 3600 * 1000);
  });
});

describe("offer-close clock — extend +24 running hours", () => {
  it("adds 24 running hours under the same pause rules", () => {
    const start = et(2026, 6, 12, 10, 0); // Friday 10:00
    const satEve = et(2026, 6, 13, 18, 0); // 32h elapsed, paused
    const base = evaluateOfferClock({
      startedAt: start,
      now: satEve,
      timeZone: NJ,
    });
    const extended = evaluateOfferClock({
      startedAt: start,
      now: satEve,
      timeZone: NJ,
      allottedRunningMs: OFFER_CLOCK_RUNNING_MS + OFFER_CLOCK_EXTEND_MS,
    });
    assert.equal(extended.remainingMs, base.remainingMs + OFFER_CLOCK_EXTEND_MS);
    assert.equal(extended.status, "paused");

    // Close instant shifts by 24 running hours after Monday 09:00 (16h leftover + 24h extend = 40h)
    const closeAt = instantWhenRunningElapsed(
      start.getTime(),
      OFFER_CLOCK_RUNNING_MS + OFFER_CLOCK_EXTEND_MS,
      NJ
    );
    assert.equal(closeAt, et(2026, 6, 17, 1, 0).getTime()); // Mon 09:00 + 40h = Wed 01:00
  });
});

describe("offer-close clock — remaining 0 marks closed", () => {
  it("closes once 48 running hours have elapsed", () => {
    const start = et(2026, 6, 10, 10, 0);
    const closeAt = et(2026, 6, 12, 10, 0);
    const snap = evaluateOfferClock({
      startedAt: start,
      now: closeAt,
      timeZone: NJ,
    });
    assert.equal(snap.status, "closed");
    assert.equal(snap.remainingMs, 0);
  });
});
