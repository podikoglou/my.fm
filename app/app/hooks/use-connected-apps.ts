import { useQuery } from "@tanstack/react-query";
import { parseResponse } from "hono/client";

import { apiClient } from "~/lib/api";

async function fetchConnectedApps() {
  return parseResponse(apiClient.oauth.apps.$get());
}

export type ConnectedAppsData = Awaited<ReturnType<typeof fetchConnectedApps>>;

export type ConnectedApp = ConnectedAppsData["apps"][number];

export function useConnectedApps() {
  return useQuery({
    queryKey: ["oauth", "apps"],
    queryFn: fetchConnectedApps,
  });
}
