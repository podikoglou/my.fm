import { useMutation } from "@tanstack/react-query";
import { parseResponse } from "hono/client";

import { apiClient } from "~/lib/api";
import { queryClient } from "~/lib/query";

export function useRevokeApp() {
  return useMutation({
    mutationFn: (id: string) =>
      parseResponse(apiClient.oauth.apps[":id"].$delete({ param: { id } })),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["oauth", "apps"] });
    },
  });
}
