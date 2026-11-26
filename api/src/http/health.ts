import { Clock, Effect } from "effect";
import { HttpApiBuilder } from "effect/http-api";

import { INGESTION_STALE_AFTER_MS, MyFmApi } from "../api/index.ts";
import { findIngestionRun } from "../db/queries/ingestionRuns.ts";
import { ping } from "../db/service.ts";

export const HealthHandlers = HttpApiBuilder.group(MyFmApi, "health", (handlers) =>
  handlers
    .handle("health", () =>
      Effect.gen(function* () {
        const ok = yield* ping().pipe(Effect.orElseSucceed(() => false));

        if (!ok) {
          return yield* Effect.fail({
            status: "error" as const,
            database: "error" as const,
          });
        }

        return {
          status: "ok" as const,
          database: "ok" as const,
        };
      }),
    )
    .handle("ingestionHealth", () =>
      Effect.gen(function* () {
        const run = yield* findIngestionRun().pipe(Effect.orDie);
        const nowMs = yield* Clock.currentTimeMillis;
        const ageMs = run ? nowMs - run.lastRunAt.getTime() : null;
        const ok = ageMs !== null && ageMs <= INGESTION_STALE_AFTER_MS;

        const body = {
          lastRunAt: run ? run.lastRunAt.toISOString() : null,
          lastRunStatus: run?.status ?? null,
          blockedUntil: run?.blockedUntil ? run.blockedUntil.toISOString() : null,
          ageSeconds: ageMs === null ? null : Math.round(ageMs / 1000),
        };

        if (!ok) {
          return yield* Effect.fail({
            status: "stale" as const,
            ...body,
          });
        }

        return {
          status: "ok" as const,
          ...body,
        };
      }),
    ),
);
