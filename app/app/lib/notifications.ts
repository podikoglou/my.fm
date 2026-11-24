import { apiClient, runApi } from "./api";
import { queryClient } from "./query";

export const NOTIFICATIONS_QUERY_KEY = ["notifications"] as const;

export async function fetchNotifications() {
  const { notifications } = await runApi(apiClient.notifications.list());

  return notifications;
}

export type Notification = Awaited<ReturnType<typeof fetchNotifications>>[number];

/**
 * Acknowledge the notification and drop it from the cached list. The list is
 * not refetched, because a refetch can create a notice again before a
 * follow-up action, such as signing in again, has run.
 */
export async function markNotificationAcknowledged(id: string) {
  await runApi(apiClient.notifications.acknowledge({ params: { id } }));

  queryClient.setQueryData<readonly Notification[]>(NOTIFICATIONS_QUERY_KEY, (notifications) =>
    notifications?.filter((notification) => notification.id !== id),
  );
}
