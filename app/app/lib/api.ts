import type { AppType } from "@my.fm/worker-api";

import { hc } from "hono/client";

export const apiClient = hc<AppType>("/api", {
  init: {
    credentials: "include",
  },
});
