import {
  createExecutionContext,
  createScheduledController,
  waitOnExecutionContext,
} from "cloudflare:test";
import { env } from "cloudflare:workers";
import { expect, test } from "vitest";

import { createDatabase } from "../src/db/index.ts";
import { findIngestionRun } from "../src/db/queries/ingestionRuns.ts";
import worker from "../src/worker.ts";

test("records the scheduled time for a cron run without accounts", async () => {
  const scheduledTime = new Date("2026-11-11T12:00:00.000Z");

  const controller = createScheduledController({
    scheduledTime: scheduledTime.getTime(),
    cron: "* * * * *",
  });

  const ctx = createExecutionContext();

  await worker.scheduled(controller, env, ctx);
  await waitOnExecutionContext(ctx);

  const heartbeat = await findIngestionRun(createDatabase(env.DB));

  expect(heartbeat?.lastRunAt).toEqual(scheduledTime);
  expect(heartbeat?.status).toBe("ok");
});
