import { Hono } from "hono";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";

import type { AppEnv } from "./types.ts";

import { createAuth } from "./auth.ts";
import scrobble from "./routes/scrobble.ts";
import user from "./routes/user.ts";

export function createApp() {
  return new Hono<AppEnv>()
    .use(
      "/*",
      cors({
        origin: (_origin, c) => c.env.FRONTEND_URL,
        credentials: true,
      }),
    )
    .on(["POST", "GET"], "/api/auth/*", (c) => createAuth(c.env).handler(c.req.raw))
    .route("/user", user)
    .route("/scrobble", scrobble)
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
