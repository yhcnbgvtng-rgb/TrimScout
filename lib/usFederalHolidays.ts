/**
 * US federal holidays as a calendar-date function (not a single-year list).
 * Observed dates: Saturday → Friday, Sunday → Monday.
 */

export interface CalendarDate {
  year: number;
  month: number; // 1–12
  day: number;
}

const MONTH_DAYS = [0, 31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

export function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return MONTH_DAYS[month] || 30;
}

/** JS weekday: 0 = Sunday … 6 = Saturday */
export function weekday(date: CalendarDate): number {
  return new Date(Date.UTC(date.year, date.month - 1, date.day)).getUTCDay();
}

export function addCalendarDays(date: CalendarDate, days: number): CalendarDate {
  const utc = Date.UTC(date.year, date.month - 1, date.day) + days * 86400000;
  const d = new Date(utc);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

export function dateKey(date: CalendarDate): string {
  return `${date.year}-${String(date.month).padStart(2, "0")}-${String(date.day).padStart(2, "0")}`;
}

export function observedDate(date: CalendarDate): CalendarDate {
  const wd = weekday(date);
  if (wd === 6) return addCalendarDays(date, -1); // Saturday → Friday
  if (wd === 0) return addCalendarDays(date, 1); // Sunday → Monday
  return date;
}

function nthWeekdayOfMonth(year: number, month: number, weekdaySun0: number, n: number): CalendarDate {
  const first = { year, month, day: 1 };
  const delta = (weekdaySun0 - weekday(first) + 7) % 7;
  return { year, month, day: 1 + delta + (n - 1) * 7 };
}

function lastWeekdayOfMonth(year: number, month: number, weekdaySun0: number): CalendarDate {
  const lastDay = daysInMonth(year, month);
  const last = { year, month, day: lastDay };
  const delta = (weekday(last) - weekdaySun0 + 7) % 7;
  return { year, month, day: lastDay - delta };
}

/**
 * The 11 US federal holidays, using observed dates when the holiday falls on a weekend.
 * Includes New Year's Day that may observe into the previous December.
 */
export function observedFederalHolidays(year: number): CalendarDate[] {
  const raw: CalendarDate[] = [
    observedDate({ year, month: 1, day: 1 }), // New Year's Day
    nthWeekdayOfMonth(year, 1, 1, 3), // MLK — 3rd Monday of January
    nthWeekdayOfMonth(year, 2, 1, 3), // Presidents — 3rd Monday of February
    lastWeekdayOfMonth(year, 5, 1), // Memorial — last Monday of May
    observedDate({ year, month: 6, day: 19 }), // Juneteenth
    observedDate({ year, month: 7, day: 4 }), // Independence Day
    nthWeekdayOfMonth(year, 9, 1, 1), // Labor — 1st Monday of September
    nthWeekdayOfMonth(year, 10, 1, 2), // Columbus / Indigenous Peoples' — 2nd Monday of October
    observedDate({ year, month: 11, day: 11 }), // Veterans Day
    nthWeekdayOfMonth(year, 11, 4, 4), // Thanksgiving — 4th Thursday of November
    observedDate({ year, month: 12, day: 25 }), // Christmas
  ];
  const seen = new Set<string>();
  const out: CalendarDate[] = [];
  for (const d of raw) {
    const key = dateKey(d);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(d);
  }
  return out.sort((a, b) => dateKey(a).localeCompare(dateKey(b)));
}

export function isWeekendDate(date: CalendarDate): boolean {
  const wd = weekday(date);
  return wd === 0 || wd === 6;
}

/** First weekday on or after `date` (skips Saturday and Sunday only). */
export function nextBusinessDayOnOrAfter(date: CalendarDate): CalendarDate {
  let cursor = date;
  while (isWeekendDate(cursor)) cursor = addCalendarDays(cursor, 1);
  return cursor;
}

/**
 * Holiday pause: 19:00 the calendar day before the observed holiday,
 * resume 09:00 the next business day after the holiday (weekends skipped).
 */
export function holidayPauseRange(holiday: CalendarDate): { startDay: CalendarDate; resumeDay: CalendarDate } {
  return {
    startDay: addCalendarDays(holiday, -1),
    resumeDay: nextBusinessDayOnOrAfter(addCalendarDays(holiday, 1)),
  };
}
