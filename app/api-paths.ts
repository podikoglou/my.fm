/**
 * Paths that the app Worker sends to the API Worker.
 *
 * One list drives both the deployed asset routing and the Worker's request
 * check, so the two cannot drift.
 */
export const API_PATH_PREFIXES = ["/api/", "/user/", "/scrobble/"] as const;

/** The exact `GET /health` path belongs to the API as well. */
export const API_HEALTH_PATH = "/health";

/**
 * Asset routing patterns for `assets.runWorkerFirst`. `/health` is exact;
 * every other entry covers a path segment and its children.
 */
export const API_RUN_WORKER_FIRST = [
  ...API_PATH_PREFIXES.map((prefix) => `${prefix}*`),
  API_HEALTH_PATH,
];

/** True when the request path must be served by the Worker API. */
export function isApiPath(pathname: string) {
  return (
    pathname === API_HEALTH_PATH || API_PATH_PREFIXES.some((prefix) => pathname.startsWith(prefix))
  );
}
