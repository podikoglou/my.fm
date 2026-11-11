import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

import { API_DEV_URL } from "../dev";
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
    proxy: Object.fromEntries(
      apiPaths.map((path) => [path, { target: apiDevUrl, changeOrigin: false }]),
    ),
  },
});
