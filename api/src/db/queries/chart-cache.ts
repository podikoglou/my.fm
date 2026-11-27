import { Effect, Schema } from "effect";
import { SqlClient } from "effect/sql";
import type { ChartPeriod } from "../../api/stats.ts";
import { RankedEntitiesSchema, type RankedEntities } from "../../stats/ranking.ts";
import type { User } from "../schema.ts";
import { asDbError } from "../service.ts";

type ChartKey = { userId: User["id"]; period: ChartPeriod; timeZone: string };

const decodeSnapshot = Schema.decodeUnknownOption(Schema.fromJsonString(RankedEntitiesSchema));

export const readSnapshot = Effect.fn("stats.readSnapshot")(function* (key: ChartKey, now: number) {
  const sql = yield* SqlClient.SqlClient;

  const rows = yield* asDbError(sql`
    SELECT snapshot FROM chart_snapshots
    WHERE userId = ${key.userId} AND period = ${key.period} AND timeZone = ${key.timeZone}
      AND expiresAt > ${now}
  `);

  return decodeSnapshot(rows[0]?.snapshot);
});

export const storeSnapshot = Effect.fn("stats.storeSnapshot")(function* (
  key: ChartKey,
  chart: RankedEntities,
  computedAt: number,
  expiresAt: number,
) {
  const sql = yield* SqlClient.SqlClient;
  yield* asDbError(sql`
    INSERT INTO chart_snapshots (userId, period, timeZone, computedAt, expiresAt, snapshot)
    VALUES (${key.userId}, ${key.period}, ${key.timeZone}, ${computedAt}, ${expiresAt}, ${JSON.stringify(chart)})
    ON CONFLICT(userId, period, timeZone) DO UPDATE SET
      computedAt = excluded.computedAt, expiresAt = excluded.expiresAt, snapshot = excluded.snapshot
    WHERE excluded.computedAt >= chart_snapshots.computedAt
  `);
});
