import { useQuery } from "@tanstack/react-query";

import { apiClient, runApi } from "~/lib/api";
import { toMonths } from "~/lib/history-timeline";

export function useScrobbleMonths(username: string) {
  return useQuery({
    queryKey: ["scrobble-months", username],
    queryFn: async () =>
      toMonths(
        await runApi(
          apiClient.scrobble.getMonths({
            query: { username, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone },
          }),
        ),
      ),
    retry: false,
  });
}
