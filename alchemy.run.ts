import * as Cloudflare from "@alchemy.run/cloudflare";
import * as Alchemy from "alchemy";
import * as Effect from "effect/Effect";
import { fileURLToPath } from "node:url";

import { API_RUN_WORKER_FIRST } from "./app/api-paths.ts";
import { Database, Worker } from "./worker-api/src/alchemy.ts";

const appDir = fileURLToPath(new URL("./app/", import.meta.url));

/**
 * Custom hostname by stage. A stage with no entry serves its `workers.dev`
 * URL; any hostname attached to it outside Alchemy stays unmanaged.
 */
const WEBSITE_DOMAINS: Record<string, string> = {
  preview: "preview.fm.aleep.lol",
};

/**
 * `Website.Vite` does not fit this build. React Router 7 declares an `ssr` Vite
 * environment even with `ssr: false`, and that resource deploys the `ssr`
 * environment by default. The SPA build then deletes `build/server`, so the
 * deploy has no bundle to upload. `StaticSite` is the documented fallback.
 *
 * The props are an Effect because `domain` depends on the stage, which the
 * `Stage` service only exposes while the stack runs. The CLI flag `--stage`
 * is not mirrored into the process environment, so `process.env` cannot
 * answer this.
 */
export const Website = Cloudflare.Website.StaticSite(
  "Website",
  Effect.gen(function* () {
    const stage = yield* Alchemy.Stage;

    return {
      cwd: appDir,
      command: "bun run build",
      outdir: "build/client",
      main: new URL("./app/worker.ts", import.meta.url).href,
      domain: WEBSITE_DOMAINS[stage],
      dev: {
        command: "bun run dev",
        env: {
          // Alchemy's CLI sets NODE_ENV=production for its own process, but the
          // React Router dev server needs the development JSX runtime.
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
    };
  }),
);

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
