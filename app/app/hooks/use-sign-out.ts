import { useMutation } from "@tanstack/react-query";
import { useNavigate } from "react-router";

import { authClient } from "~/lib/auth";
import { queryClient } from "~/lib/query";

export function useSignOut() {
  const navigate = useNavigate();

  return useMutation({
    mutationFn: async () => {
      const { error } = await authClient.signOut();

      if (error) throw new Error(error.message ?? "Sign-out failed.");
    },
    onSuccess: () => {
      queryClient.clear();

      return navigate("/feed", { replace: true });
    },
  });
}
