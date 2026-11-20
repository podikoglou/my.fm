import { Link } from "react-router";

import { useNotifications } from "~/hooks/use-notifications";
import { notificationPath } from "~/lib/notifications";
import { getNotificationKind } from "~/notifications/kinds";

export function NotificationList() {
  const { data: notifications } = useNotifications();

  if (!notifications?.length) return null;

  return (
    <ul aria-label="Notifications" className="flex flex-col gap-2 px-6">
      {notifications.map((notification) => {
        const { Content } = getNotificationKind(notification.type);

        return (
          <li key={notification.id}>
            <Link
              to={notificationPath(notification.id)}
              className="block rounded-lg focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
            >
              <Content notification={notification} />
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
