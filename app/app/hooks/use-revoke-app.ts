import { useMutation } from "@tanstack/react-query";

import { apiClient, runApi } from "~/lib/api";
import { queryClient } from "~/lib/query";

export function useRevokeApp() {
  return useMutation({
    mutationFn: (id: string) => runApi(apiClient.oauth.revokeApp({ params: { id } })),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["oauth", "apps"] });
    },
  });
}
