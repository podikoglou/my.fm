import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

import { API_DEV_URL, APP_DEV_PORT, DEV_APP_HOST } from "../dev";
import { API_HEALTH_PATH, API_PATH_PREFIXES } from "./api-paths";

/**
 * `alchemy dev` starts the API Worker on the shared dev port. A standalone
 * `bun run dev` in this package has no API behind the proxy; run
 * `bun run dev` from the repository root instead.
 */
const apiDevUrl = process.env.API_DEV_URL ?? API_DEV_URL;

/**
 * Path-segment patterns, so `/apiary` is not proxied. A key that starts with
 * `^` is a regular expression in Vite's proxy config.
 */
const apiPaths = [...API_PATH_PREFIXES.map((prefix) => `^${prefix}`), `^${API_HEALTH_PATH}$`];

export default defineConfig({
  plugins: [tailwindcss(), reactRouter(), tsconfigPaths()],
  server: {
    // Caddy proxies `https://my.fm` to this port, so the port must be fixed.
    port: APP_DEV_PORT,
    strictPort: true,
    // Caddy forwards the browser's Host header.
    allowedHosts: [DEV_APP_HOST],
    // `changeOrigin: false` keeps the original Host header. With it set to
    // `true`, the API Worker would see the wrong origin and the Spotify
    // callback would change. This setting is load-bearing.
    proxy: Object.fromEntries(
      apiPaths.map((path) => [path, { target: apiDevUrl, changeOrigin: false }]),
    ),
  },
});
