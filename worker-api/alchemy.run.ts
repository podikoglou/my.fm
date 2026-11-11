import * as Cloudflare from "@alchemy.run/cloudflare";
import * as Alchemy from "alchemy";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";

import { Database } from "./src/database.ts";

export const Worker = Cloudflare.Worker("Worker", {
  main: "./src/worker.ts",
  compatibility: { date: "2026-11-02" },
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

export default Alchemy.Stack(
  "MyFM",
  {
    providers: Cloudflare.providers(),
    state: Cloudflare.state(),
  },
  Effect.gen(function* () {
    const database = yield* Database;
    const worker = yield* Worker;

    return {
      url: worker.url,
      databaseName: database.databaseName,
    };
  }),
);
