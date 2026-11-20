import { useQuery } from "@tanstack/react-query";

import { authClient } from "~/lib/auth";
import { fetchNotifications, NOTIFICATIONS_QUERY_KEY } from "~/lib/notifications";

export function useNotifications() {
  const { data: session } = authClient.useSession();

  // The API answers 401 without a session, so ask only when there is one.
  return useQuery({
    queryKey: NOTIFICATIONS_QUERY_KEY,
    queryFn: fetchNotifications,
    enabled: Boolean(session),
  });
}
