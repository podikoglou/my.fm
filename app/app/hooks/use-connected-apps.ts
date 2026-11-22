import { useQuery } from "@tanstack/react-query";

import { apiClient, runApi } from "~/lib/api";

async function fetchConnectedApps() {
  return runApi(apiClient.oauth.listApps());
}

export type ConnectedAppsData = Awaited<ReturnType<typeof fetchConnectedApps>>;

export type ConnectedApp = ConnectedAppsData["apps"][number];

export function useConnectedApps() {
  return useQuery({
    queryKey: ["oauth", "apps"],
    queryFn: fetchConnectedApps,
  });
}
