import type { ComponentType } from "react";

import type { Notification } from "~/lib/notifications";

/** How the app renders and acknowledges one notification type. */
export type NotificationKind = {
  /** The notification's content; the shared list wraps it in the link. */
  Content: ComponentType<{ notification: Notification }>;
  /**
   * Runs when the user opens the notification, as the page's loader. It
   * returns the loader's result, such as a redirect.
   */
  acknowledge: (notification: Notification) => Promise<Response | null>;
};
