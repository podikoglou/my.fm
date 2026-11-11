import * as Cloudflare from "@alchemy.run/cloudflare";
import * as Alchemy from "alchemy";
import * as Effect from "effect/Effect";

import { Database } from "./src/database.ts";

export const Worker = Cloudflare.Worker("Worker", {
  main: "./src/worker.ts",
  compatibility: { date: "2026-11-02" },
  env: { DB: Database },
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
