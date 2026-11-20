import { useMutation } from "@tanstack/react-query";

import type { Notification } from "~/lib/notifications";

import { getNotificationKind } from "~/notifications/kinds";

export function useAcknowledgeNotification() {
  return useMutation({
    mutationFn: (notification: Notification) =>
      getNotificationKind(notification.type).acknowledge(notification),
  });
}
