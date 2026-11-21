import { useQuery } from "@tanstack/react-query";
import { parseResponse } from "hono/client";

import { apiClient } from "~/lib/api";

export function useConnectedApps() {
  return useQuery({
    queryKey: ["oauth", "apps"],
    queryFn: () => parseResponse(apiClient.oauth.apps.$get()),
  });
}
