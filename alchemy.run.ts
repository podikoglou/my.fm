import * as Cloudflare from "@alchemy.run/cloudflare";
import * as Alchemy from "alchemy";
import * as Effect from "effect/Effect";
import { fileURLToPath } from "node:url";

import { API_RUN_WORKER_FIRST } from "./app/api-paths.ts";
import { Database, Worker } from "./worker-api/src/alchemy.ts";

const appDir = fileURLToPath(new URL("./app/", import.meta.url));

/**
 * The web application is a Vite single-page build served from a Worker with
 * the static assets. A custom entry serves the assets and forwards the API
 * paths to the Worker API over a service binding, so the browser sees one
 * origin.
 *
 * React Router's build drives its own Vite pipeline. The app uses
 * `StaticSite` and not `Website.Vite`: React Router 7 declares the `rsc` and
 * `ssr` Vite environments even when `ssr: false`. `Website.Vite` deploys the
 * `ssr` environment by default and treats a non-empty server input as a
 * Worker bundle. React Router's SPA build then deletes `build/server`, so that
 * bundle is missing. `entry: "client"` is rejected, and `ViteProps` does not
 * expose `skipEnvironments`. `StaticSite` is the documented fallback for a
 * build that does not fit the `Vite` resource.
 *
 * During `alchemy dev`, `dev.command` runs the React Router dev server and the
 * Vite proxy uses the shared API dev URL. The route list is shared with the
 * deployed Worker.
 */
export const Website = Cloudflare.Website.StaticSite("Website", {
  cwd: appDir,
  command: "bun run build",
  outdir: "build/client",
  main: new URL("./app/worker.ts", import.meta.url).href,
  dev: {
    command: "bun run dev",
    env: {
      // Alchemy's CLI sets NODE_ENV=production. React Router's dev server
      // needs the development JSX runtime.
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
