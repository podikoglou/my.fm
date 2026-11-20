import { Bell } from "lucide-react";
import { redirect } from "react-router";

import type { Notification } from "~/lib/notifications";

import { Alert, AlertDescription, AlertTitle } from "~/components/ui/alert";
import { markNotificationAcknowledged } from "~/lib/notifications";

import type { NotificationKind } from "./kind";

export function DefaultNotificationContent({ notification }: { notification: Notification }) {
  return (
    // The list's link carries the semantics; a persistent notice is not an alert.
    <Alert role={undefined} className="transition-colors hover:bg-muted/50">
      <Bell />
      <AlertTitle>{notification.title}</AlertTitle>
      <AlertDescription>{notification.body}</AlertDescription>
    </Alert>
  );
}

export const defaultNotificationKind: NotificationKind = {
  Content: DefaultNotificationContent,
  async acknowledge({ id }) {
    await markNotificationAcknowledged(id);

    return redirect("/");
  },
};
