import { useQuery } from "@tanstack/react-query";

import { apiClient, runApi } from "~/lib/api";
import { authClient } from "~/lib/auth";

async function fetchCurrentUser() {
  return runApi(apiClient.user.me());
}

export type CurrentUser = Awaited<ReturnType<typeof fetchCurrentUser>>;

export function useCurrentUser() {
  return useQuery({ queryKey: ["user", "me"], queryFn: fetchCurrentUser });
}

export function useFeedViewer() {
  const { data: session } = authClient.useSession();

  const { data: user } = useQuery({
    queryKey: ["user", "me", session?.user.id],
    queryFn: fetchCurrentUser,
    enabled: Boolean(session),
  });

  return session && user?.id === session.user.id ? user : undefined;
}
