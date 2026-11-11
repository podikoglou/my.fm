import * as Cloudflare from "@alchemy.run/cloudflare";
import * as Alchemy from "alchemy";
import * as Effect from "effect/Effect";
import { fileURLToPath } from "node:url";

import { Database, Worker } from "./worker-api/src/alchemy.ts";

const appDir = fileURLToPath(new URL("./app/", import.meta.url));

/**
 * The web application is built by Vite and served from a Worker with the
 * static assets. A custom entry serves the assets and forwards the API paths
 * to the Worker API over a service binding, so the browser sees one origin.
 *
 * `dev.command` runs the Vite dev server, while the API Worker still starts in
 * local workerd. The Vite server proxies the API paths to it.
 */
export const Website = Cloudflare.Website.StaticSite("Website", {
  cwd: appDir,
  command: "bun run build",
  outdir: "build/client",
  main: new URL("./app/worker.ts", import.meta.url).href,
  dev: {
    command: "bun run dev",
    // Alchemy runs local commands with NODE_ENV=production; React Router
    // renders with the production JSX runtime and fails in dev.
    env: { NODE_ENV: "development" },
  },
  assets: {
    // The SPA fallback must not answer API requests.
    notFoundHandling: "single-page-application",
    runWorkerFirst: ["/api/*", "/user/*", "/scrobble/*", "/health"],
  },
  env: {
    API: Worker,
  },
});

export type WebsiteEnv = Cloudflare.InferEnv<typeof Website> & {
  ASSETS: Fetcher;
};

export default Alchemy.Stack(
  "MyFM",
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
