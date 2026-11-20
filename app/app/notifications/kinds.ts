import type { NotificationKind } from "./kind";

import { defaultNotificationKind } from "./default";

const kinds = new Map<string, NotificationKind>([]);

/** The kind for a notification type, or the default for a type the app does not know. */
export function getNotificationKind(type: string): NotificationKind {
  return kinds.get(type) ?? defaultNotificationKind;
}
