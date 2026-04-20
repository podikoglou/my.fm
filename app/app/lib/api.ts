import { hc } from "hono/client";
import type { AppType } from "@my.fm/api";

export const apiClient = hc<AppType>(import.meta.env.VITE_API_URL, {
  init: {
    credentials: "include",
  },
});
