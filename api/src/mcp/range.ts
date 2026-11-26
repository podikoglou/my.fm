import { Clock, Effect, Schema } from "effect";

import { TimeZoneSchema } from "../api/scrobble.ts";
import { StatsInputSchemas } from "../api/stats.ts";
import { InvalidCursorError } from "../scrobbles/errors.ts";
import { CALENDAR_RANGES, calendarRangeBounds } from "../time-zone.ts";

const RangeName = Schema.Literals(CALENDAR_RANGES);

export const CalendarRangeFields = {
  range: Schema.optionalKey(
    RangeName.annotate({
      description:
        "Local calendar period in timeZone (UTC by default). last_7_days includes today and the previous six dates. Use range or explicit since/until.",
    }),
  ),
  timeZone: Schema.optionalKey(
    TimeZoneSchema.annotate({
      description: "IANA time zone for calendar dates, such as Europe/Athens. Defaults to UTC.",
    }),
  ),
};

type RangeInput = {
  readonly range?: typeof RangeName.Type;
  readonly since?: number;
  readonly until?: number;
  readonly timeZone?: string;
  readonly cursor?: string;
};

export const exclusiveRange = Schema.makeFilter(
  (input: RangeInput) => !input.range || (input.since === undefined && input.until === undefined),
  { message: "Use range or explicit since/until" },
);

const CalendarCursor = Schema.StringFromBase64Url.pipe(
  Schema.decodeTo(
    Schema.fromJsonString(
      Schema.Struct({
        range: RangeName,
        timeZone: Schema.String,
        since: StatsInputSchemas.unixSeconds,
        until: StatsInputSchemas.unixSeconds,
        cursor: Schema.String,
      }),
    ),
  ),
);

type CalendarWindow = Omit<typeof CalendarCursor.Type, "cursor">;

const encodeCursor = Schema.encodeSync(CalendarCursor);
const decodeCursor = Schema.decodeUnknownEffect(CalendarCursor);

export function calendarCursor(calendar: CalendarWindow | undefined, cursor: string | null) {
  return calendar && cursor ? encodeCursor({ ...calendar, cursor }) : cursor;
}

export function resolveToolRange<T extends RangeInput>(input: T) {
  return Effect.gen(function* () {
    if (!input.range) return { ...input, calendar: undefined };

    const timeZone = input.timeZone ?? "UTC";

    if (input.cursor !== undefined) {
      const invalid = new InvalidCursorError({ message: "Invalid cursor" });
      const saved = yield* decodeCursor(input.cursor).pipe(Effect.mapError(() => invalid));

      if (saved.range !== input.range || saved.timeZone !== timeZone) return yield* invalid;

      const { cursor, ...calendar } = saved;

      return { ...input, ...calendar, cursor, calendar };
    }

    const now = yield* Clock.currentTimeMillis;
    const bounds = calendarRangeBounds(input.range, timeZone, now);
    const calendar = { range: input.range, timeZone, ...bounds };

    return { ...input, ...bounds, calendar };
  });
}
