import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";

import type { WorkerEnv } from "../alchemy.run.ts";

export function createApp() {
  return new Hono<{ Bindings: WorkerEnv }>()
    .get("/health", async (c) => {
      const row = await c.env.DB.prepare("SELECT 1 AS ok").first<{ ok: number }>();
      const ok = row?.ok === 1;

      return c.json({ status: ok ? "ok" : "error", database: ok ? "ok" : "error" }, ok ? 200 : 503);
    })
    .onError((err, c) => {
      const status = err instanceof HTTPException ? err.status : 500;
      return c.json({ error: err.message ?? "Internal server error" }, status);
    });
}
