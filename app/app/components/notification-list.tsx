import { useAcknowledgeNotification } from "~/hooks/use-acknowledge-notification";
import { useNotifications } from "~/hooks/use-notifications";
import { getNotificationKind } from "~/notifications/kinds";

export function NotificationList() {
  const notifications = useNotifications();
  const acknowledge = useAcknowledgeNotification();

  if (!notifications?.length) return null;

  return (
    <div className="flex max-h-48 shrink-0 flex-col gap-2 overflow-y-auto px-6">
      <ul aria-label="Notifications" className="flex flex-col gap-2">
        {notifications.map((notification) => {
          const { Content } = getNotificationKind(notification.type);

          return (
            <li key={notification.id}>
              <button
                type="button"
                onClick={() => acknowledge.mutate(notification)}
                disabled={acknowledge.isPending}
                className="block w-full cursor-pointer rounded-lg text-left focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none disabled:cursor-default disabled:opacity-50"
              >
                <Content notification={notification} />
              </button>
            </li>
          );
        })}
      </ul>

      {acknowledge.isError && (
        <p className="text-sm text-destructive">Something went wrong. Please try again.</p>
      )}
    </div>
  );
}
