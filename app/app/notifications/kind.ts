import type { ComponentType } from "react";

import type { Notification } from "~/lib/notifications";

/** How the app renders and acknowledges one notification type. */
export type NotificationKind = {
  /** The notification's content; the shared list wraps it in the button that acknowledges it. */
  Content: ComponentType<{ notification: Notification }>;
  /** What clicking the notification does. It acknowledges the notification, and may do more. */
  acknowledge: (notification: Notification) => Promise<void>;
};
