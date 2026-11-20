import { parseResponse } from "hono/client";

import { apiClient } from "./api";
import { queryClient } from "./query";

export const NOTIFICATIONS_QUERY_KEY = ["notifications"] as const;

export async function fetchNotifications() {
  const { notifications } = await parseResponse(apiClient.notifications.$get());

  return notifications;
}

export type Notification = Awaited<ReturnType<typeof fetchNotifications>>[number];

/** The page a notification links to, where opening it runs its acknowledge action. */
export function notificationPath(id: string) {
  return `/notifications/${encodeURIComponent(id)}`;
}

/** The signed-in user's unacknowledged notification with this ID, if any. */
export async function findNotification(id: string) {
  const notifications = await queryClient.fetchQuery({
    queryKey: NOTIFICATIONS_QUERY_KEY,
    queryFn: fetchNotifications,
  });

  return notifications.find((notification) => notification.id === id);
}

export async function markNotificationAcknowledged(id: string) {
  await parseResponse(apiClient.notifications[":id"].acknowledge.$post({ param: { id } }));
  await queryClient.invalidateQueries({ queryKey: NOTIFICATIONS_QUERY_KEY });
}
