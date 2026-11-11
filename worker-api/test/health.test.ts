import { describe, expect, test } from "bun:test";

import { createApp } from "../src/app.ts";

const database = {
  prepare: () => ({ first: async () => ({ ok: 1 }) }),
} as unknown as D1Database;

describe("GET /health", () => {
  test("reports the Worker and database as healthy", async () => {
    const response = await createApp().request("/health", undefined, { DB: database });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok", database: "ok" });
  });
});
