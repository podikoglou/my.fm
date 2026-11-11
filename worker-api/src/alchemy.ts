import * as Cloudflare from "@alchemy.run/cloudflare";
import * as Alchemy from "alchemy";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";

import { API_DEV_PORT } from "../../dev.ts";
import { Database } from "./database.ts";

export { Database } from "./database.ts";

/**
 * Better Auth needs a stable signing secret. Alchemy mints one on the first
 * deploy and keeps it in stack state, so no low-entropy value lives in `.env`
 * and later deploys do not invalidate existing sessions.
 */
const BetterAuthSecret = Alchemy.Random("BetterAuthSecret").pipe(
  Effect.map((secret) => secret.text),
);

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
  // The app dev proxy reads the same constant. A conflict must fail loudly.
  dev: { port: API_DEV_PORT, strictPort: true },
  // MIGRATION NOTE: A Cron Trigger replaces the Bun scheduler's five-second
  // in-process timer.
  crons: ["* * * * *"],
  env: {
    DB: Database,
    // The ingestion path constructs Better Auth without a request, so it uses
    // the Worker's own URL as its base URL. Normal auth requests pass the
    // incoming app origin instead.
    WORKER_URL: Cloudflare.Worker.URL,
    BETTER_AUTH_SECRET: BetterAuthSecret,
    // The app and API share one origin at runtime. Better Auth derives its
    // base URL, trusted origin, and Spotify callback from each request, so
    // none of them need deploy-time values.
    SPOTIFY_CLIENT_ID: Config.String("SPOTIFY_CLIENT_ID"),
    SPOTIFY_CLIENT_SECRET: Config.Redacted("SPOTIFY_CLIENT_SECRET"),
  },
});

export type WorkerEnv = Cloudflare.InferEnv<typeof Worker>;
