import { skipToken, useQuery } from "@tanstack/react-query";

import type { CurrentUser } from "~/hooks/use-current-user";

import { apiClient, runApi } from "~/lib/api";

export function useLastListen(user: CurrentUser | undefined) {
  const { data } = useQuery({
    queryKey: ["last-listen", user?.id, user?.username],
    queryFn: user?.onboarded
      ? () =>
          runApi(
            apiClient.scrobble.getRecent({
              query: { username: user.username, offset: 0, limit: 1 },
            }),
          )
      : skipToken,
    retry: false,
  });

  return data?.[0];
}
