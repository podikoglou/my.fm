/**
 * The local API Worker port used by `alchemy dev`.
 *
 * The Worker resource and the app's Vite proxy both read this value, so a port
 * change is one edit. `strictPort` makes a conflict fail loudly.
 */
export const API_DEV_PORT = 1337;

/** The local API origin that the app dev server proxies to. */
export const API_DEV_URL = `http://localhost:${API_DEV_PORT}`;
