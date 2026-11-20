import { useQuery } from "@tanstack/react-query";

import { authClient } from "~/lib/auth";
import { fetchNotifications, NOTIFICATIONS_QUERY_KEY } from "~/lib/notifications";

/** The signed-in user's unacknowledged notifications, or nothing without a session. */
export function useNotifications() {
  const { data: session } = authClient.useSession();

  // The API answers 401 without a session, so ask only when there is one.
  const { data } = useQuery({
    queryKey: NOTIFICATIONS_QUERY_KEY,
    queryFn: fetchNotifications,
    enabled: Boolean(session),
  });

  // A cached list outlives the session that fetched it, so it is not shown without one.
  return session ? data : undefined;
}
