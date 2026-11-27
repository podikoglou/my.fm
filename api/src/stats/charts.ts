import { Clock, Effect, Option } from "effect";
import { MAX_TOP_LIMIT, type ChartRange } from "../api/stats.ts";
import { readSnapshot, storeSnapshot } from "../db/queries/chart-cache.ts";
import { findTopEntities } from "../db/queries/stats.ts";
import type { User } from "../db/schema.ts";
import { chartWindow } from "./period.ts";
import type { TopKind } from "./ranking.ts";

const TTL_SECONDS = 15 * 60;
export const chartKinds = ["artists", "albums", "tracks"] as const;

export const loadChart = Effect.fn("stats.loadChart")(function* (
  userId: User["id"],
  { period = "all", timeZone, since, until }: ChartRange,
  kinds: readonly [TopKind, ...TopKind[]],
  limit: number,
) {
  if (since !== undefined || until !== undefined) {
    return yield* findTopEntities(userId, { since, until, kinds, limit });
  }

  const now = new Date(yield* Clock.currentTimeMillis);
  const nowSeconds = Math.floor(now.getTime() / 1000);

  const zone =
    period === "today"
      ? new Intl.DateTimeFormat("en", { timeZone: timeZone ?? "UTC" }).resolvedOptions().timeZone
      : "";

  const key = { userId, period, timeZone: zone };
  const cached = yield* readSnapshot(key, nowSeconds);

  if (Option.isSome(cached)) return cached.value;

  const range = chartWindow(period, now, zone);

  const chart = yield* findTopEntities(userId, {
    ...range,
    kinds: chartKinds,
    limit: MAX_TOP_LIMIT,
  });

  const expiresAt = Math.min(nowSeconds + TTL_SECONDS, range.dayEnd ?? Infinity);

  // An exhausted write quota must not turn a successful chart read into a 503.
  yield* storeSnapshot(key, chart, nowSeconds, expiresAt).pipe(
    Effect.catch((error) => Effect.logWarning("Could not store chart snapshot", error._tag)),
  );

  return chart;
});
