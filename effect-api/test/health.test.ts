import { env } from "cloudflare:workers";
import { describe, expect, test } from "vitest";

import { INGESTION_STALE_AFTER_MS } from "../src/api/index.ts";
import { recordIngestionRun } from "../src/db/queries/ingestionRuns.ts";
import { runWithInfra } from "../src/http/app.ts";
import worker, { makeWorkerInfraLayer } from "../src/worker.ts";

function request(path: string, init?: RequestInit) {
  return worker.fetch(new Request(`https://app.test${path}`, init), env);
}

describe("GET /health", () => {
  test("reports the Worker and database as healthy with private no-store caching", async () => {
    const response = await request("/health");

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await response.json()).toEqual({ status: "ok", database: "ok" });
  });
});

describe("GET /health/ingestion", () => {
  test("reports stale before the first run", async () => {
    const response = await request("/health/ingestion");

    expect(response.status).toBe(503);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
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

    await runWithInfra(
      recordIngestionRun({
        at: new Date(),
        status: "quota",
        blockedUntil,
      }),
      makeWorkerInfraLayer(env),
    );

    const response = await request("/health/ingestion");

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

    await runWithInfra(recordIngestionRun({ at, status: "ok" }), makeWorkerInfraLayer(env));

    const response = await request("/health/ingestion");

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ status: "stale", lastRunStatus: "ok" });
  });
});

describe("default Cache-Control", () => {
  test("sets private, no-store on unmatched routes", async () => {
    const response = await request("/does-not-exist");

    expect(response.status).toBe(404);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  });
});
