import { Bell } from "lucide-react";
import { Link } from "react-router";

import { useNotifications } from "~/hooks/use-notifications";
import { notificationPath } from "~/lib/notifications";

import { Alert, AlertDescription, AlertTitle } from "./ui/alert";

export function NotificationList() {
  const { data: notifications } = useNotifications();

  if (!notifications?.length) return null;

  return (
    <ul aria-label="Notifications" className="flex flex-col gap-2 px-6">
      {notifications.map((notification) => (
        <li key={notification.id}>
          <Link
            to={notificationPath(notification.id)}
            className="block rounded-lg focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            {/* The link carries the semantics; a persistent notice is not an alert. */}
            <Alert role={undefined} className="transition-colors hover:bg-muted/50">
              <Bell />
              <AlertTitle>{notification.title}</AlertTitle>
              <AlertDescription>{notification.body}</AlertDescription>
            </Alert>
          </Link>
        </li>
      ))}
    </ul>
  );
}
