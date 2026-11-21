/**
 * Paths that the app Worker sends to the API Worker.
 *
 * One list drives both the deployed asset routing and the Worker's request
 * check, so the two cannot drift. The user and scrobble routes live under
 * `/api`, because `/user/:username` is a page in the web app.
 */
export const API_PATH_PREFIXES = ["/api/", "/.well-known/oauth-"] as const;

/** The exact `GET /health` path belongs to the API as well. */
export const API_HEALTH_PATH = "/health";
export const API_EXACT_PATHS = [API_HEALTH_PATH, "/mcp", "/token", "/register"] as const;

/**
 * Asset routing patterns for `assets.runWorkerFirst`.
 */
export const API_RUN_WORKER_FIRST = [
  ...API_PATH_PREFIXES.map((prefix) => `${prefix}*`),
  ...API_EXACT_PATHS,
];

/** True when the request path must be served by the Worker API. */
export function isApiPath(pathname: string) {
  return (
    API_EXACT_PATHS.some((path) => pathname === path) ||
    API_PATH_PREFIXES.some((prefix) => pathname.startsWith(prefix))
  );
}
