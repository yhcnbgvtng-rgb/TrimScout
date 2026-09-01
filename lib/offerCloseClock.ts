/**
 * 48-hour offer-close clock with weekend + federal-holiday pauses.
 * Pure functions: callers pass fixed instants. No network I/O.
 */

import {
  addCalendarDays,
  holidayPauseRange,
  observedFederalHolidays,
  type CalendarDate,
} from "./usFederalHolidays";
import { DEFAULT_DEAL_TIME_ZONE } from "./usTimeZones";

export const OFFER_CLOCK_RUNNING_MS = 48 * 60 * 60 * 1000;
export const OFFER_CLOCK_EXTEND_MS = 24 * 60 * 60 * 1000;

export type OfferClockStatus = "idle" | "running" | "paused" | "closed";
export type OfferPauseReason = "weekend" | "holiday" | "weekend_and_holiday";

export interface OfferClockInput {
  startedAt: string | number | Date | null | undefined;
  allottedRunningMs?: number;
  closedAt?: string | number | Date | null;
  timeZone?: string;
  now: string | number | Date;
}

export interface OfferClockSnapshot {
  status: OfferClockStatus;
  remainingMs: number;
  allottedRunningMs: number;
  timeZone: string;
  startedAt: string | null;
  closedAt: string | null;
  paused: boolean;
  pauseReason: OfferPauseReason | null;
  resumeAt: string | null;
}

export interface PauseInterval {
  startMs: number;
  endMs: number;
  weekend: boolean;
  holiday: boolean;
}

interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  weekday: number; // 0 Sun … 6 Sat
}

function toDate(value: string | number | Date): Date {
  if (value instanceof Date) return value;
  return new Date(value);
}

function timeZoneOffsetMs(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const num = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const asUtc = Date.UTC(num("year"), num("month") - 1, num("day"), num("hour"), num("minute"), num("second"));
  return asUtc - date.getTime();
}

export function zonedLocalToUtc(
  timeZone: string,
  year: number,
  month: number,
  day: number,
  hour: number,
  minute = 0,
  second = 0
): Date {
  const naiveUtc = Date.UTC(year, month - 1, day, hour, minute, second);
  const offset1 = timeZoneOffsetMs(new Date(naiveUtc), timeZone);
  const instant1 = naiveUtc - offset1;
  const offset2 = timeZoneOffsetMs(new Date(instant1), timeZone);
  return new Date(naiveUtc - offset2);
}

export function zonedParts(date: Date, timeZone: string): ZonedParts {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value || "";
  const weekdayMap: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    hour: Number(get("hour")),
    minute: Number(get("minute")),
    second: Number(get("second")),
    weekday: weekdayMap[get("weekday")] ?? 0,
  };
}

function ymdOf(parts: ZonedParts): CalendarDate {
  return { year: parts.year, month: parts.month, day: parts.day };
}

function atLocal(timeZone: string, date: CalendarDate, hour: number, minute = 0): number {
  return zonedLocalToUtc(timeZone, date.year, date.month, date.day, hour, minute).getTime();
}

function enumerateDates(from: CalendarDate, to: CalendarDate): CalendarDate[] {
  const out: CalendarDate[] = [];
  let cursor = from;
  const endKey = `${to.year}-${to.month}-${to.day}`;
  for (let i = 0; i < 800; i++) {
    out.push(cursor);
    if (`${cursor.year}-${cursor.month}-${cursor.day}` === endKey) break;
    cursor = addCalendarDays(cursor, 1);
  }
  return out;
}

export function weekendPauseIntervals(from: CalendarDate, to: CalendarDate, timeZone: string): PauseInterval[] {
  const paddedFrom = addCalendarDays(from, -7);
  const paddedTo = addCalendarDays(to, 8);
  const intervals: PauseInterval[] = [];
  for (const date of enumerateDates(paddedFrom, paddedTo)) {
    const probe = zonedLocalToUtc(timeZone, date.year, date.month, date.day, 12, 0);
    if (zonedParts(probe, timeZone).weekday !== 6) continue;
    const monday = addCalendarDays(date, 2);
    intervals.push({
      startMs: atLocal(timeZone, date, 18, 0),
      endMs: atLocal(timeZone, monday, 9, 0),
      weekend: true,
      holiday: false,
    });
  }
  return intervals;
}

export function holidayPauseIntervals(years: number[], timeZone: string): PauseInterval[] {
  const intervals: PauseInterval[] = [];
  const seen = new Set<string>();
  for (const year of years) {
    for (const holiday of observedFederalHolidays(year)) {
      const key = `${holiday.year}-${holiday.month}-${holiday.day}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const range = holidayPauseRange(holiday);
      intervals.push({
        startMs: atLocal(timeZone, range.startDay, 19, 0),
        endMs: atLocal(timeZone, range.resumeDay, 9, 0),
        weekend: false,
        holiday: true,
      });
    }
  }
  return intervals;
}

function yearsCovering(fromMs: number, toMs: number, timeZone: string): number[] {
  const a = zonedParts(new Date(fromMs), timeZone).year;
  const b = zonedParts(new Date(toMs), timeZone).year;
  const start = Math.min(a, b) - 1;
  const end = Math.max(a, b) + 1;
  const years: number[] = [];
  for (let y = start; y <= end; y++) years.push(y);
  return years;
}

export function pauseIntervalsOverlapping(fromMs: number, toMs: number, timeZone: string): PauseInterval[] {
  const fromParts = zonedParts(new Date(fromMs), timeZone);
  const toParts = zonedParts(new Date(toMs), timeZone);
  const weekend = weekendPauseIntervals(ymdOf(fromParts), ymdOf(toParts), timeZone);
  const holiday = holidayPauseIntervals(yearsCovering(fromMs, toMs, timeZone), timeZone);
  return [...weekend, ...holiday].filter((iv) => iv.endMs > fromMs && iv.startMs < toMs);
}

function containingIntervals(atMs: number, intervals: PauseInterval[]): PauseInterval[] {
  return intervals.filter((iv) => atMs >= iv.startMs && atMs < iv.endMs);
}

export function pauseReasonAt(atMs: number, timeZone: string): OfferPauseReason | null {
  const windowMs = 14 * 86400000;
  const hits = containingIntervals(atMs, pauseIntervalsOverlapping(atMs - windowMs, atMs + windowMs, timeZone));
  if (hits.length === 0) return null;
  const weekend = hits.some((h) => h.weekend);
  const holiday = hits.some((h) => h.holiday);
  if (weekend && holiday) return "weekend_and_holiday";
  if (holiday) return "holiday";
  return "weekend";
}

function nextResumeAt(atMs: number, timeZone: string): number | null {
  const windowMs = 21 * 86400000;
  let t = atMs;
  let advanced = false;
  for (let i = 0; i < 24; i++) {
    const hits = containingIntervals(
      t,
      pauseIntervalsOverlapping(t - windowMs, t + windowMs, timeZone)
    );
    if (hits.length === 0) return advanced ? t : null;
    const next = Math.max(...hits.map((h) => h.endMs));
    if (next <= t) t += 60 * 1000;
    else t = next;
    advanced = true;
  }
  return t;
}

function mergeIntervals(intervals: PauseInterval[]): Array<{ startMs: number; endMs: number }> {
  const sorted = [...intervals].sort((a, b) => a.startMs - b.startMs);
  const merged: Array<{ startMs: number; endMs: number }> = [];
  for (const iv of sorted) {
    const last = merged[merged.length - 1];
    if (!last || iv.startMs > last.endMs) {
      merged.push({ startMs: iv.startMs, endMs: iv.endMs });
    } else {
      last.endMs = Math.max(last.endMs, iv.endMs);
    }
  }
  return merged;
}

export function elapsedRunningMs(startedAtMs: number, untilMs: number, timeZone: string): number {
  if (untilMs <= startedAtMs) return 0;
  const merged = mergeIntervals(pauseIntervalsOverlapping(startedAtMs, untilMs, timeZone));
  let paused = 0;
  for (const iv of merged) {
    const lo = Math.max(iv.startMs, startedAtMs);
    const hi = Math.min(iv.endMs, untilMs);
    if (hi > lo) paused += hi - lo;
  }
  return Math.max(0, untilMs - startedAtMs - paused);
}

export function instantWhenRunningElapsed(
  startedAtMs: number,
  allottedRunningMs: number,
  timeZone: string
): number {
  if (allottedRunningMs <= 0) return startedAtMs;
  let t = startedAtMs;
  let remaining = allottedRunningMs;
  const horizon = startedAtMs + allottedRunningMs + 120 * 86400000;
  for (let i = 0; i < 4000; i++) {
    if (t >= horizon) return horizon;
    const reason = pauseReasonAt(t, timeZone);
    if (reason) {
      const resume = nextResumeAt(t, timeZone);
      if (resume == null || resume <= t) t += 60 * 1000;
      else t = resume;
      continue;
    }
    const look = pauseIntervalsOverlapping(t, t + 21 * 86400000, timeZone);
    const nextPause = look
      .map((iv) => iv.startMs)
      .filter((start) => start > t)
      .sort((a, b) => a - b)[0];
    const runUntil = nextPause ?? t + remaining;
    const available = runUntil - t;
    if (remaining <= available) return t + remaining;
    remaining -= available;
    t = runUntil;
  }
  return t;
}

export function evaluateOfferClock(input: OfferClockInput): OfferClockSnapshot {
  const timeZone = input.timeZone || DEFAULT_DEAL_TIME_ZONE;
  const allottedRunningMs = Number.isFinite(input.allottedRunningMs)
    ? Math.max(0, Number(input.allottedRunningMs))
    : OFFER_CLOCK_RUNNING_MS;
  const now = toDate(input.now);
  const nowMs = now.getTime();
  const started = input.startedAt ? toDate(input.startedAt) : null;
  const closed = input.closedAt ? toDate(input.closedAt) : null;

  if (!started || Number.isNaN(started.getTime())) {
    return {
      status: "idle",
      remainingMs: allottedRunningMs,
      allottedRunningMs,
      timeZone,
      startedAt: null,
      closedAt: closed && !Number.isNaN(closed.getTime()) ? closed.toISOString() : null,
      paused: false,
      pauseReason: null,
      resumeAt: null,
    };
  }

  const startedAtMs = started.getTime();
  const elapsed = elapsedRunningMs(startedAtMs, nowMs, timeZone);
  let remainingMs = Math.max(0, allottedRunningMs - elapsed);
  const closeMs =
    closed && !Number.isNaN(closed.getTime())
      ? closed.getTime()
      : remainingMs <= 0
        ? instantWhenRunningElapsed(startedAtMs, allottedRunningMs, timeZone)
        : null;

  if (closeMs != null && nowMs >= closeMs) {
    return {
      status: "closed",
      remainingMs: 0,
      allottedRunningMs,
      timeZone,
      startedAt: started.toISOString(),
      closedAt: new Date(closeMs).toISOString(),
      paused: false,
      pauseReason: null,
      resumeAt: null,
    };
  }

  remainingMs = Math.max(0, allottedRunningMs - elapsed);
  const pauseReason = pauseReasonAt(nowMs, timeZone);
  const resumeMs = pauseReason ? nextResumeAt(nowMs, timeZone) : null;

  return {
    status: pauseReason ? "paused" : "running",
    remainingMs,
    allottedRunningMs,
    timeZone,
    startedAt: started.toISOString(),
    closedAt: null,
    paused: Boolean(pauseReason),
    pauseReason,
    resumeAt: resumeMs != null ? new Date(resumeMs).toISOString() : null,
  };
}

export function formatRemainingClock(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${String(hours).padStart(2, "0")}h : ${String(minutes).padStart(2, "0")}m : ${String(seconds).padStart(2, "0")}s`;
}

export function pauseReasonLabel(reason: OfferPauseReason | null): string | null {
  if (reason === "weekend") return "Paused for the weekend";
  if (reason === "holiday") return "Paused for a federal holiday";
  if (reason === "weekend_and_holiday") return "Paused for the weekend and a federal holiday";
  return null;
}
