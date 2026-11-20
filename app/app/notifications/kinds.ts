import type { NotificationKind } from "./kind";

import { defaultNotificationKind } from "./default";

const kinds: Record<string, NotificationKind | undefined> = {};

/** The kind for a notification type, or the default for a type the app does not know. */
export function getNotificationKind(type: string): NotificationKind {
  return kinds[type] ?? defaultNotificationKind;
}
