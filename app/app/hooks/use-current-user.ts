import { useQuery } from "@tanstack/react-query";

import { apiClient, runApi } from "~/lib/api";

async function fetchCurrentUser() {
  return runApi(apiClient.user.me());
}

export type CurrentUser = Awaited<ReturnType<typeof fetchCurrentUser>>;

export function useCurrentUser() {
  return useQuery({ queryKey: ["user", "me"], queryFn: fetchCurrentUser });
}
