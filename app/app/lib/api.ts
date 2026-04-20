import type { AppType } from "@my.fm/api";

import { hc } from "hono/client";

export const apiClient = hc<AppType>(import.meta.env.VITE_API_URL, {
  init: {
    credentials: "include",
  },
});
