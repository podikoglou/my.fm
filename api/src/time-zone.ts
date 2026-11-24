/** Whether `timeZone` is an IANA name this runtime knows. */
export function isTimeZone(timeZone: string) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });

    return true;
  } catch {
    return false;
  }
}

function wallClockFormatter(timeZone: string) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
  });
}

function utcOffsetMs(instant: number, formatter: Intl.DateTimeFormat) {
  const parts = formatter.formatToParts(instant);

  const part = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((candidate) => candidate.type === type)?.value);

  return (
    Date.UTC(
      part("year"),
      part("month") - 1,
      part("day"),
      part("hour"),
      part("minute"),
      part("second"),
    ) -
    Math.floor(instant / 1000) * 1000
  );
}

const HOUR_MS = 3_600_000;

/**
 * The instant local midnight starts the wall-clock day, resolved the way `new
 * Date(year, monthIndex, day)` resolves it in the browser: a midnight that
 * occurs twice takes the first, and one skipped by a DST gap moves forward
 * past the gap. `wallClock` is that midnight written as if it were UTC.
 */
function startOfLocalDay(wallClock: number, formatter: Intl.DateTimeFormat) {
  const offsetBefore = utcOffsetMs(wallClock - 14 * HOUR_MS, formatter);
  const offsetAfter = utcOffsetMs(wallClock + 14 * HOUR_MS, formatter);

  const candidates = [wallClock - offsetBefore, wallClock - offsetAfter].filter(
    (instant) => instant === wallClock - utcOffsetMs(instant, formatter),
  );

  return candidates.length > 0 ? Math.min(...candidates) : wallClock - offsetBefore;
}

/**
 * Every calendar month in `timeZone` from `first` to `last`, newest first,
 * with the instant it starts.
 */
export function monthsBetween(first: Date, last: Date, timeZone: string) {
  const formatter = wallClockFormatter(timeZone);
  const local = (date: Date) => new Date(date.getTime() + utcOffsetMs(date.getTime(), formatter));
  const from = local(first);
  const to = local(last);
  const months = [];

  for (
    let year = to.getUTCFullYear(), monthIndex = to.getUTCMonth();
    year > from.getUTCFullYear() ||
    (year === from.getUTCFullYear() && monthIndex >= from.getUTCMonth());
    monthIndex === 0 ? ((year -= 1), (monthIndex = 11)) : (monthIndex -= 1)
  ) {
    months.push({
      month: `${year}-${String(monthIndex + 1).padStart(2, "0")}`,
      start: Math.floor(startOfLocalDay(Date.UTC(year, monthIndex, 1), formatter) / 1000),
    });
  }

  return months;
}

export type CalendarUnit = "day" | "week" | "month" | "year";

export type CalendarBucket = {
  /** `YYYY` for a year, `YYYY-MM` for a month, the first day `YYYY-MM-DD` otherwise. */
  label: string;
  /** Unix seconds. */
  start: number;
  /** Unix seconds, exclusive: the start of the following bucket. */
  end: number;
};

function alignWallClock(date: Date, unit: CalendarUnit) {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  const day = date.getUTCDate();

  switch (unit) {
    case "day":
      return Date.UTC(year, month, day);
    case "week":
      // Weeks start on Monday.
      return Date.UTC(year, month, day - ((date.getUTCDay() + 6) % 7));
    case "month":
      return Date.UTC(year, month, 1);
    case "year":
      return Date.UTC(year, 0, 1);
  }
}

function nextWallClock(wallClock: number, unit: CalendarUnit) {
  const date = new Date(wallClock);
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  const day = date.getUTCDate();

  switch (unit) {
    case "day":
      return Date.UTC(year, month, day + 1);
    case "week":
      return Date.UTC(year, month, day + 7);
    case "month":
      return Date.UTC(year, month + 1, 1);
    case "year":
      return Date.UTC(year + 1, 0, 1);
  }
}

function bucketLabel(wallClock: number, unit: CalendarUnit) {
  const iso = new Date(wallClock).toISOString();

  switch (unit) {
    case "year":
      return iso.slice(0, 4);
    case "month":
      return iso.slice(0, 7);
    case "week":
    case "day":
      return iso.slice(0, 10);
  }
}

/**
 * Every calendar bucket in `timeZone` from the one holding `first` to the one
 * holding `last`, oldest first. Stops after `limit` buckets, so a caller can
 * detect a range that is too long without building it.
 */
export function calendarBuckets(
  first: Date,
  last: Date,
  unit: CalendarUnit,
  timeZone: string,
  limit: number,
): CalendarBucket[] {
  const formatter = wallClockFormatter(timeZone);
  const local = (date: Date) => new Date(date.getTime() + utcOffsetMs(date.getTime(), formatter));
  const lastWallClock = local(last).getTime();
  const buckets: CalendarBucket[] = [];

  for (
    let wallClock = alignWallClock(local(first), unit);
    wallClock <= lastWallClock && buckets.length < limit;
    wallClock = nextWallClock(wallClock, unit)
  ) {
    buckets.push({
      label: bucketLabel(wallClock, unit),
      start: Math.floor(startOfLocalDay(wallClock, formatter) / 1000),
      end: Math.floor(startOfLocalDay(nextWallClock(wallClock, unit), formatter) / 1000),
    });
  }

  return buckets;
}
