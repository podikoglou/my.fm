import {
  createExecutionContext,
  createScheduledController,
  waitOnExecutionContext,
} from "cloudflare:test";
import { env } from "cloudflare:workers";
import { Effect } from "effect";
import { expect, test } from "vitest";

import { findIngestionRun } from "../src/db/queries/ingestionRuns.ts";
import { Db } from "../src/db/service.ts";
import worker from "../src/worker.ts";

test("records the scheduled time for a cron run without accounts", async () => {
  const scheduledTime = new Date("2026-11-11T12:00:00.000Z");

  const controller = createScheduledController({
    scheduledTime: scheduledTime.getTime(),
    cron: "* * * * *",
  });

  const ctx = createExecutionContext();

  worker.scheduled(controller, env, ctx);
  await waitOnExecutionContext(ctx);

  const heartbeat = await Effect.runPromise(
    findIngestionRun().pipe(Effect.provide(Db.layerFromBinding(env.DB))),
  );

  expect(heartbeat?.lastRunAt).toEqual(scheduledTime);
  expect(heartbeat?.status).toBe("ok");
});
