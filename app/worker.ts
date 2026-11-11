import type { WebsiteEnv } from "../alchemy.run.ts";

const API_PREFIXES = ["/api/", "/user/", "/scrobble/"];

/**
 * The API paths are served by the Worker API through the `API` service
 * binding. Every other path is served from the built SPA assets.
 *
 * Keeping the browser on one origin means the Better Auth session cookie is
 * first-party and the Spotify callback returns to the app origin.
 */
function isApiRequest(pathname: string) {
  return pathname === "/health" || API_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

export default {
  fetch(request: Request, env: WebsiteEnv) {
    return isApiRequest(new URL(request.url).pathname)
      ? env.API.fetch(request)
      : env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<WebsiteEnv>;
