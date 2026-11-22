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
 * The instant local midnight starts the month, resolved the way `new Date(year,
 * monthIndex, 1)` resolves it in the browser: a midnight that occurs twice
 * takes the first, and one skipped by a DST gap moves forward past the gap.
 */
function startOfMonthIn(year: number, monthIndex: number, formatter: Intl.DateTimeFormat) {
  const wallClock = Date.UTC(year, monthIndex, 1);

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
      start: Math.floor(startOfMonthIn(year, monthIndex, formatter) / 1000),
    });
  }

  return months;
}
