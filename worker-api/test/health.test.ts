import { env } from "cloudflare:workers";
import { describe, expect, test } from "vitest";

import { createApp } from "../src/app.ts";
import { createDatabase } from "../src/db/index.ts";
import { recordIngestionRun } from "../src/db/queries/ingestionRuns.ts";
import { INGESTION_STALE_AFTER_MS } from "../src/ingestion/run.ts";

describe("GET /health", () => {
  test("reports the Worker and database as healthy", async () => {
    const response = await createApp().request("/health", undefined, env);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok", database: "ok" });
  });
});

describe("GET /health/ingestion", () => {
  test("reports stale before the first run", async () => {
    const response = await createApp().request("/health/ingestion", undefined, env);

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      status: "stale",
      lastRunAt: null,
      lastRunStatus: null,
      blockedUntil: null,
      ageSeconds: null,
    });
  });

  test("reports the end of a block", async () => {
    const blockedUntil = new Date(Date.now() + 60 * 60_000);
    await recordIngestionRun(createDatabase(env.DB), {
      at: new Date(),
      status: "quota",
      blockedUntil,
    });

    const response = await createApp().request("/health/ingestion", undefined, env);

    // The schedule is alive, so the run counts as fresh even while Spotify
    // blocks it.
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      status: "ok",
      blockedUntil: blockedUntil.toISOString(),
    });
  });

  test("reports stale when the last run is too old", async () => {
    const at = new Date(Date.now() - INGESTION_STALE_AFTER_MS - 60_000);
    await recordIngestionRun(createDatabase(env.DB), { at, status: "ok" });

    const response = await createApp().request("/health/ingestion", undefined, env);

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ status: "stale", lastRunStatus: "ok" });
  });
});
