import { useQuery } from "@tanstack/react-query";
import { parseResponse } from "hono/client";

import { apiClient } from "~/lib/api";

async function fetchCurrentUser() {
  return parseResponse(apiClient.user.me.$get());
}

export type CurrentUser = Awaited<ReturnType<typeof fetchCurrentUser>>;

export function useCurrentUser() {
  return useQuery({ queryKey: ["user", "me"], queryFn: fetchCurrentUser });
}
