import { useQuery } from "@tanstack/react-query";

import { apiClient, runApi } from "~/lib/api";

async function fetchLatestImport() {
  return runApi(apiClient.import.latest());
}

const IMPORT_POLL_INTERVAL_MS = 15 * 1000;

export function useLatestImport() {
  return useQuery({
    queryKey: ["import", "latest"],
    queryFn: fetchLatestImport,
    refetchInterval: (query) => {
      const status = query.state.data?.import?.status;

      return status === "pending" || status === "processing" ? IMPORT_POLL_INTERVAL_MS : false;
    },
  });
}
