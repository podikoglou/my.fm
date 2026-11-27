import type { ChartPeriod } from "../api/stats.ts";
import type { ScrobbleRange } from "../db/queries/scrobbles.ts";
import { calendarBuckets } from "../time-zone.ts";

const rollingDays = { week: 7, month: 30, sixMonths: 180, year: 365 } as const;

export function chartWindow(
  period: ChartPeriod,
  now: Date,
  timeZone = "UTC",
): ScrobbleRange & { dayEnd?: number } {
  if (period === "all") return {};

  // Play timestamps have second precision and until is exclusive.
  const until = Math.floor(now.getTime() / 1000) + 1;

  if (period === "today") {
    const [day] = calendarBuckets(now, now, "day", timeZone, 1);

    if (!day) throw new Error("Missing local day");

    return { since: day.start, until, dayEnd: day.end };
  }

  return { since: until - rollingDays[period] * 86_400, until };
}
