import * as Cloudflare from "@alchemy.run/cloudflare";
import * as Alchemy from "alchemy";
import * as Config from "effect/Config";

import { API_DEV_PORT } from "../../dev.ts";
import { Database } from "./database.ts";

export { Database } from "./database.ts";

const BetterAuthSecret = Alchemy.makeRandom("BetterAuthSecret");

export const Worker = Cloudflare.Worker("Worker", {
  main: new URL("./worker.ts", import.meta.url).href,
  compatibility: { date: "2026-11-02" },
  dev: { port: API_DEV_PORT, strictPort: true },
  crons: ["* * * * *"],
  env: {
    DB: Database,
    BETTER_AUTH_SECRET: BetterAuthSecret,
    SPOTIFY_CLIENT_ID: Config.String("SPOTIFY_CLIENT_ID"),
    SPOTIFY_CLIENT_SECRET: Config.Redacted("SPOTIFY_CLIENT_SECRET"),
  },
});

export type WorkerEnv = Cloudflare.InferEnv<typeof Worker>;
