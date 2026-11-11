import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";

import type { AppEnv } from "./types.ts";

import { createAuth } from "./auth.ts";
import scrobble from "./routes/scrobble.ts";
import user from "./routes/user.ts";

export function createApp() {
  return (
    new Hono<AppEnv>()
      // The browser reaches this API through the app Worker, so every request is
      // same-origin and CORS is not part of the contract.
      .on(["POST", "GET"], "/api/auth/*", (c) => createAuth(c.env).handler(c.req.raw))
      .route("/user", user)
      .route("/scrobble", scrobble)
      .get("/health", async (c) => {
        const row = await c.env.DB.prepare("SELECT 1 AS ok").first<{ ok: number }>();
        const ok = row?.ok === 1;

        return c.json(
          { status: ok ? "ok" : "error", database: ok ? "ok" : "error" },
          ok ? 200 : 503,
        );
      })
      .onError((err, c) => {
        const status = err instanceof HTTPException ? err.status : 500;
        return c.json({ error: err.message ?? "Internal server error" }, status);
      })
  );
}

/**
 * The Hono RPC type for the API. Clients import this type to type their
 * requests, as the web application does with the Bun API's `AppType`.
 */
export type AppType = ReturnType<typeof createApp>;
