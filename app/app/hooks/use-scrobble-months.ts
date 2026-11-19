import { useQuery } from "@tanstack/react-query";
import { parseResponse } from "hono/client";

import { apiClient } from "~/lib/api";
import { toMonths } from "~/lib/history-timeline";

export function useScrobbleMonths(username: string) {
  return useQuery({
    queryKey: ["scrobble-months", username],
    queryFn: async () =>
      toMonths(
        await parseResponse(
          apiClient.scrobble.getMonths.$get({
            query: { username, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone },
          }),
        ),
      ),
    retry: false,
  });
}
