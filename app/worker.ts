import type { WebsiteEnv } from "../alchemy.run.ts";

import { isApiPath } from "./api-paths.ts";

/**
 * The API paths are served by the Worker API through the `API` service
 * binding. Every other path is served from the built SPA assets.
 *
 * Keeping the browser on one origin means the Better Auth session cookie is
 * first-party and the Spotify callback returns to the app origin.
 */
export default {
  fetch(request: Request, env: WebsiteEnv) {
    return isApiPath(new URL(request.url).pathname)
      ? env.API.fetch(request)
      : env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<WebsiteEnv>;
