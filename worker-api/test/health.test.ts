import { describe, expect, test } from "bun:test";

import { createApp } from "../src/app.ts";

function createDatabase(first: () => Promise<unknown>): D1Database {
  return {
    prepare: () => ({ first }),
  } as unknown as D1Database;
}

describe("GET /health", () => {
  test("reports the Worker and database as healthy", async () => {
    const app = createApp();

    const response = await app.request("/health", undefined, {
      DB: createDatabase(async () => ({ ok: 1 })),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok", database: "ok" });
  });

  test("reports an unhealthy database", async () => {
    const app = createApp();

    const response = await app.request("/health", undefined, {
      DB: createDatabase(async () => null),
    });

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ status: "error", database: "error" });
  });

  test("uses the shared error response shape when the query fails", async () => {
    const app = createApp();

    const response = await app.request("/health", undefined, {
      DB: createDatabase(async () => {
        throw new Error("database unavailable");
      }),
    });

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "database unavailable" });
  });
});
