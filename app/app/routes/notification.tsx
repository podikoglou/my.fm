import { data } from "react-router";

import { CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { requireAuth } from "~/lib/auth-guard";
import { findNotification } from "~/lib/notifications";
import { getNotificationKind } from "~/notifications/kinds";

import type { Route } from "./+types/notification";

export function meta() {
  return [{ title: "Notification · my.fm" }];
}

export async function clientLoader({ params }: Route.ClientLoaderArgs) {
  const { user } = await requireAuth(`/notifications/${encodeURIComponent(params.id)}`);

  if (!user) return null;

  const notification = await findNotification(params.id);

  if (!notification) {
    throw data("Notification not found", { status: 404 });
  }

  return getNotificationKind(notification.type).acknowledge(notification);
}

export default function NotificationPage() {
  return (
    <CardHeader className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
      <div>
        <CardTitle className="text-3xl font-bold">One moment</CardTitle>
        <CardDescription className="mt-2">Opening your notification.</CardDescription>
      </div>
    </CardHeader>
  );
}
