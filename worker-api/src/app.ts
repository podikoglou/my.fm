import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";

import type { AppEnv } from "./types.ts";

import { createAuth } from "./auth.ts";
import { createDatabase } from "./db/index.ts";
import { findIngestionRun } from "./db/queries/ingestionRuns.ts";
import { INGESTION_STALE_AFTER_MS } from "./ingestion/run.ts";
import feed from "./routes/feed.ts";
import scrobble from "./routes/scrobble.ts";
import user from "./routes/user.ts";

/**
 * The routes that belong to the browser client, mounted at `/api`.
 *
 * `/user/:username` is a page in the web application, so the user API cannot
 * keep the bare `/user` prefix. The web application forwards `/api/*` here.
 */
function createApi() {
  return new Hono<AppEnv>()
    .on(["POST", "GET"], "/auth/*", (c) => createAuth(c.env).handler(c.req.raw))
    .route("/user", user)
    .route("/scrobble", scrobble)
    .route("/feed", feed);
}

export function createApp() {
  return (
    new Hono<AppEnv>()
      /**
       * Workers Cache checks before the Worker runs, so a response without a
       * policy can be stored by heuristic freshness. User routes authenticate
       * with a cookie, which does not trigger the automatic bypass. Every
       * response therefore starts private; only a public route opts in.
       */
      .use("*", async (c, next) => {
        await next();

        if (!c.res.headers.has("Cache-Control")) {
          c.header("Cache-Control", "private, no-store");
        }
      })
      .route("/api", createApi())
      // Health stays at the root, where monitoring expects it.
      .get("/health", async (c) => {
        const row = await c.env.DB.prepare("SELECT 1 AS ok").first<{ ok: number }>();
        const ok = row?.ok === 1;

        return c.json(
          { status: ok ? "ok" : "error", database: ok ? "ok" : "error" },
          ok ? 200 : 503,
        );
      })
      .get("/health/ingestion", async (c) => {
        const run = await findIngestionRun(createDatabase(c.env.DB));
        const ageMs = run ? Date.now() - run.lastRunAt.getTime() : null;
        const ok = ageMs !== null && ageMs <= INGESTION_STALE_AFTER_MS;

        return c.json(
          {
            status: ok ? "ok" : "stale",
            lastRunAt: run?.lastRunAt ?? null,
            lastRunStatus: run?.status ?? null,
            blockedUntil: run?.blockedUntil ?? null,
            ageSeconds: ageMs === null ? null : Math.round(ageMs / 1000),
          },
          ok ? 200 : 503,
        );
      })
      .notFound((c) =>
        c.json({ error: "Not found" }, 404, { "Cache-Control": "private, no-store" }),
      )
      .onError((err, c) => {
        const status = err instanceof HTTPException ? err.status : 500;

        return c.json({ error: err.message ?? "Internal server error" }, status, {
          "Cache-Control": "private, no-store",
        });
      })
  );
}

/**
 * The Hono RPC type for the client routes. Clients mount it at `/api`, so
 * `hc<AppType>("/api")` reaches the same paths that the web application
 * forwards.
 */
export type AppType = ReturnType<typeof createApi>;
