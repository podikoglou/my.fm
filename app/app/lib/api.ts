import { getDefaultStore } from "jotai";
import { hc } from "hono/client";
import type { AppType } from "@my.fm/api";
import { accessTokenAtom } from "~/state/auth";

const store = getDefaultStore();

function getAuthHeader() {
  const token = store.get(accessTokenAtom);
  if (!token) return undefined;
  return { Authorization: `Bearer ${token}` };
}

export const apiClient = hc<AppType>(import.meta.env.VITE_API_URL, {
  headers: getAuthHeader(),
});
