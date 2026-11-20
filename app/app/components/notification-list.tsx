import { Bell } from "lucide-react";
import { Link } from "react-router";

import { useNotifications } from "~/hooks/use-notifications";
import { notificationPath } from "~/lib/notifications";

export function NotificationList() {
  const { data: notifications } = useNotifications();

  if (!notifications?.length) return null;

  return (
    <ul aria-label="Notifications" className="flex flex-col gap-2 px-6">
      {notifications.map((notification) => (
        <li key={notification.id}>
          <Link
            to={notificationPath(notification.id)}
            className="flex items-start gap-3 rounded-lg border p-4 transition-colors hover:bg-muted/50 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            <Bell className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />

            <div className="min-w-0 space-y-1">
              <p className="text-sm font-medium">{notification.title}</p>
              <p className="text-sm text-muted-foreground">{notification.body}</p>
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}
