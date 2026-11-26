import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

import { API_DEV_URL, DEV_APP_HOST } from "../dev";
import { API_EXACT_PATHS, API_PATH_PREFIXES } from "../app/api-paths";

const apiDevUrl = process.env.API_DEV_URL ?? API_DEV_URL;

const apiPaths = [
  ...API_PATH_PREFIXES.map((prefix) => `^${prefix.replaceAll(".", String.raw`\.`)}`),
  ...API_EXACT_PATHS.map((path) => `^${path}$`),
];

export default defineConfig({
  plugins: [tailwindcss()],
  server: {
    port: 5174,
    strictPort: true,
    allowedHosts: [DEV_APP_HOST],
    proxy: Object.fromEntries(
      apiPaths.map((path) => [path, { target: apiDevUrl, changeOrigin: false }]),
    ),
  },
});
