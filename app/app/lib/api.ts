import type { AppType } from "@my.fm/worker-api";

import { hc } from "hono/client";

/**
 * The app and API share an origin, so the client uses relative paths. This
 * works unchanged on `workers.dev`, a custom domain, and the local dev server.
 */
export const apiClient = hc<AppType>("", {
  init: {
    credentials: "include",
  },
});
