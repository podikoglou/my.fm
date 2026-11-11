import type { AppType } from "@my.fm/worker-api";

import { hc } from "hono/client";

import { apiUrl } from "./api-url";

export const apiClient = hc<AppType>(apiUrl, {
  init: {
    credentials: "include",
  },
});
