/** Local API Worker port used by `alchemy dev`. */
export const API_DEV_PORT = 1337;

/** Local API origin used by the app dev proxy. */
export const API_DEV_URL = `http://localhost:${API_DEV_PORT}`;

/** App dev server port used by the Caddy proxy. */
export const APP_DEV_PORT = 5173;

/** Local HTTPS app host served by Caddy. */
export const DEV_APP_HOST = "my.fm";
