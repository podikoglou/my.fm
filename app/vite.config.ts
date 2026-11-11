import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

/**
 * `localhost:1337` is the Worker API during `alchemy dev`. The deployed app
 * Worker forwards the same paths to the API over a service binding.
 */
const apiDevUrl = process.env.API_DEV_URL ?? "http://localhost:1337";

export default defineConfig({
  plugins: [tailwindcss(), reactRouter(), tsconfigPaths()],
  server: {
    // The Better Auth URLs in the root `.env` use this port.
    strictPort: true,
    allowedHosts: ["my.fm"],
    proxy: Object.fromEntries(
      ["/api", "/user", "/scrobble", "/health"].map((path) => [
        path,
        { target: apiDevUrl, changeOrigin: false },
      ]),
    ),
  },
});
