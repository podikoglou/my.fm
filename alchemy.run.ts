import * as Cloudflare from "@alchemy.run/cloudflare";
import * as Alchemy from "alchemy";
import * as Effect from "effect/Effect";
import { fileURLToPath } from "node:url";

import { API_RUN_WORKER_FIRST } from "./app/api-paths.ts";
import { Database, Worker } from "./worker-api/src/alchemy.ts";

const appDir = fileURLToPath(new URL("./app/", import.meta.url));

export const Website = Cloudflare.Website.StaticSite("Website", {
  cwd: appDir,
  command: "bun run build",
  outdir: "build/client",
  main: new URL("./app/worker.ts", import.meta.url).href,
  dev: {
    command: "bun run dev",
    env: {
      NODE_ENV: "development",
    },
  },
  assets: {
    // The SPA fallback must not answer API requests.
    notFoundHandling: "single-page-application",
    runWorkerFirst: API_RUN_WORKER_FIRST,
  },
  env: {
    API: Worker,
  },
});

/**
 * `InferEnv` covers declared bindings. The asset layer adds `ASSETS`
 * automatically, so the handler type adds the binding Cloudflare supplies.
 */
export type WebsiteEnv = Cloudflare.InferEnv<typeof Website> & {
  ASSETS: Fetcher;
};

export default Alchemy.Stack(
  "my-fm",
  {
    providers: Cloudflare.providers(),
    state: Cloudflare.state(),
  },
  Effect.gen(function* () {
    const database = yield* Database;
    const worker = yield* Worker;
    const website = yield* Website;

    return {
      url: website.url,
      apiUrl: worker.url,
      databaseName: database.databaseName,
    };
  }),
);
