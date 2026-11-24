import type { CalendarBucket } from "../time-zone.ts";

export type TimelineBucket = Pick<CalendarBucket, "label"> & { count: number };

export type TimelineGap = {
  /** Label of the first empty bucket. */
  from: string;
  /** Label of the last empty bucket. */
  to: string;
  buckets: number;
};

/**
 * Runs of consecutive empty buckets, longest first, then most recent first.
 * Buckets come from the first to the last scrobble, so no run counts the time
 * before tracking started or after the latest play.
 */
export function findGaps(buckets: ReadonlyArray<TimelineBucket>, limit: number): TimelineGap[] {
  const gaps: (TimelineGap & { end: number })[] = [];
  let runStart: number | undefined;

  for (const [index, bucket] of buckets.entries()) {
    if (bucket.count === 0) {
      runStart ??= index;
      continue;
    }

    const first = runStart === undefined ? undefined : buckets[runStart];
    const last = buckets[index - 1];

    if (runStart !== undefined && first && last) {
      gaps.push({ from: first.label, to: last.label, buckets: index - runStart, end: index });
    }

    runStart = undefined;
  }

  return gaps
    .toSorted((a, b) => b.buckets - a.buckets || b.end - a.end)
    .slice(0, limit)
    .map(({ end: _, ...gap }) => gap);
}
