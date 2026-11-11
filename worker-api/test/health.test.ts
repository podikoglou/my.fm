import { describe, expect, test } from "bun:test";

import { createApp } from "../src/app.ts";
import { createTestEnv } from "./harness.ts";

describe("GET /health", () => {
  test("reports the Worker and database as healthy", async () => {
    const env = createTestEnv();
    const response = await createApp().request("/health", undefined, env);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok", database: "ok" });
  });
});
