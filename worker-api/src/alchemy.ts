import * as Cloudflare from "@alchemy.run/cloudflare";
import * as Alchemy from "alchemy";
import * as Config from "effect/Config";

import { API_DEV_PORT } from "../../dev.ts";
import { Database } from "./database.ts";

export { Database } from "./database.ts";

/**
 * Minted once and kept in stack state. A new value would invalidate every
 * session that Better Auth has issued.
 */
const BetterAuthSecret = Alchemy.makeRandom("BetterAuthSecret");

export const Worker = Cloudflare.Worker("Worker", {
  main: new URL("./worker.ts", import.meta.url).href,
  compatibility: { date: "2026-11-02" },
  dev: { port: API_DEV_PORT, strictPort: true },
  // Runs every minute. Ingestion dynamically adjusts per-user fetch intervals
  // (every 3 minutes for active listeners, every 10 minutes for inactive users)
  // to stay well within Spotify's quota while delivering near real-time updates.
  crons: ["* * * * *"],
  cache: { enabled: true },
  // Workers Logs is on by default. Issues groups the errors that ingestion
  // catches and logs, which the invocation outcome alone does not show.
  observability: { enabled: true, issues: { enabled: true } },
  env: {
    DB: Database,
    BETTER_AUTH_SECRET: BetterAuthSecret,
    SPOTIFY_CLIENT_ID: Config.String("SPOTIFY_CLIENT_ID"),
    SPOTIFY_CLIENT_SECRET: Config.Redacted("SPOTIFY_CLIENT_SECRET"),
  },
});

export type WorkerEnv = Cloudflare.InferEnv<typeof Worker>;
