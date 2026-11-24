import { useMutation } from "@tanstack/react-query";

import type { CurrentUser } from "~/hooks/use-current-user";

import { apiClient, runApi } from "~/lib/api";
import { queryClient } from "~/lib/query";

export function usePrivacySetting() {
  return useMutation({
    mutationFn: (isPrivate: CurrentUser["isPrivate"]) =>
      runApi(apiClient.user.updateSettings({ payload: { isPrivate } })),
    onSuccess: (settings) => {
      queryClient.setQueryData<CurrentUser>(["user", "me"], (user) =>
        user ? { ...user, isPrivate: settings.isPrivate } : user,
      );
    },
  });
}
