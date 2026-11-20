import { useMutation } from "@tanstack/react-query";
import { parseResponse } from "hono/client";
import { z } from "zod";

import type { CurrentUser } from "~/hooks/use-current-user";

import { apiClient } from "~/lib/api";
import { queryClient } from "~/lib/query";

const privacySettingSchema = z.object({ isPrivate: z.boolean() });

export function usePrivacySetting() {
  return useMutation({
    mutationFn: (isPrivate: CurrentUser["isPrivate"]) =>
      parseResponse(
        apiClient.user.settings.$patch({ json: privacySettingSchema.parse({ isPrivate }) }),
      ),
    onSuccess: (settings) => {
      queryClient.setQueryData<CurrentUser>(["user", "me"], (user) =>
        user ? { ...user, isPrivate: settings.isPrivate } : user,
      );
    },
  });
}
