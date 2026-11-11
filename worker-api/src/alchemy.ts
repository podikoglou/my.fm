import * as Cloudflare from "@alchemy.run/cloudflare";
import * as Config from "effect/Config";

import { Database } from "./database.ts";

export { Database } from "./database.ts";

/**
 * The Worker API resource.
 *
 * The stack that deploys this Worker lives in the repository root so the web
 * application can be deployed next to it. `main` is anchored to this file so
 * the resource resolves from the root stack.
 */
export const Worker = Cloudflare.Worker("Worker", {
  main: new URL("./worker.ts", import.meta.url).href,
  compatibility: { date: "2026-11-02" },
  // The app dev proxy targets this port, so a conflict must fail loudly.
  dev: { port: 1337, strictPort: true },
  // MIGRATION NOTE: A Cron Trigger replaces the Bun scheduler's five-second
  // in-process timer.
  crons: ["* * * * *"],
  env: {
    DB: Database,
    BETTER_AUTH_SECRET: Config.Redacted("BETTER_AUTH_SECRET"),
    BETTER_AUTH_URL: Config.String("BETTER_AUTH_URL"),
    FRONTEND_URL: Config.String("FRONTEND_URL"),
    SPOTIFY_CLIENT_ID: Config.String("SPOTIFY_CLIENT_ID"),
    SPOTIFY_CLIENT_SECRET: Config.Redacted("SPOTIFY_CLIENT_SECRET"),
    SPOTIFY_REDIRECT_URI: Config.String("SPOTIFY_REDIRECT_URI"),
  },
});

export type WorkerEnv = Cloudflare.InferEnv<typeof Worker>;
