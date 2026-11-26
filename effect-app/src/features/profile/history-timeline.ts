import { format, isToday } from "date-fns";
import { Schema } from "effect";

// A track row is 52px tall with a 4px gap below it. The list is laid out from
// this constant before any row loads, so it must match the rendered row.
export const ROW_HEIGHT = 56;
export const PAGE_SIZE = 8;
const OVERSCAN = 2;

export const MonthSchema = Schema.Struct({
  key: Schema.String,
  label: Schema.String,
  shortLabel: Schema.String,
  start: Schema.Finite,
  count: Schema.Finite,
  before: Schema.Finite,
});

export type Month = typeof MonthSchema.Type;

export interface HistoryPage {
  readonly month: Month;
  readonly page: number;
}

export function historyPageId({ month, page }: HistoryPage): string {
  return `${month.key}:${month.count}:${page}`;
}

export function toMonths(
  counts: readonly { readonly month: string; readonly count: number }[],
): readonly Month[] {
  let start = 0;

  return counts.map(({ month, count }): Month => {
    const [year = 0, monthNumber = 1] = month.split("-").map(Number);
    const first = new Date(year, monthNumber - 1, 1);

    const result: Month = {
      key: month,
      label: format(first, "MMMM yyyy"),
      shortLabel: format(first, "MMM yyyy"),
      start,
      count,
      before: Math.floor(new Date(year, monthNumber, 1).getTime() / 1000),
    };

    start += count;

    return result;
  });
}

export function totalPlays(months: readonly Month[]): number {
  const last = months.at(-1);

  return last ? last.start + last.count : 0;
}

export function monthAt(months: readonly Month[], index: number): Month {
  let low = 0;
  let high = months.length - 1;

  while (low < high) {
    const middle = (low + high + 1) >> 1;

    if (months[middle].start <= index) low = middle;
    else high = middle - 1;
  }

  return months[low];
}

export function rowAddress(months: readonly Month[], index: number) {
  const month = monthAt(months, index);
  const offset = index - month.start;

  return { month, page: Math.floor(offset / PAGE_SIZE), slot: offset % PAGE_SIZE };
}

export function rowsInView(scrollTop: number, viewportHeight: number, total: number) {
  return {
    first: Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN),
    last: Math.min(total - 1, Math.floor((scrollTop + viewportHeight) / ROW_HEIGHT) + OVERSCAN),
  };
}

export function pagesBetween(
  months: readonly Month[],
  { first, last }: { readonly first: number; readonly last: number },
): readonly HistoryPage[] {
  const pages = new Map<string, HistoryPage>();

  for (let index = first; index <= last; index++) {
    const { month, page } = rowAddress(months, index);

    pages.set(`${month.key}:${page}`, { month, page });
  }

  return [...pages.values()];
}

// The heading names the month at the top of the list, so a row from that month
// leaves it out. A row from an older month further down still names its own.
export function formatScrobbleDate(date: Date, withMonth: boolean): string {
  const time = date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

  if (isToday(date)) return `Today, ${time}`;

  return `${format(date, withMonth ? "EEE d MMM" : "EEE d")}, ${time}`;
}
