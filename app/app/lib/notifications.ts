import { parseResponse } from "hono/client";

import { apiClient } from "./api";
import { authClient } from "./auth";
import { signInWithSpotify } from "./auth-guard";
import { queryClient } from "./query";

export const NOTIFICATIONS_QUERY_KEY = ["notifications"] as const;

/** The path that a notification links to, where opening it acknowledges it. */
export function notificationPath(id: string) {
  return `/notifications/${encodeURIComponent(id)}`;
}

export async function fetchNotifications() {
  const { notifications } = await parseResponse(apiClient.notifications.$get());

  return notifications;
}

/**
 * Acknowledge the notification, then sign out and send the user back through
 * Spotify sign-in, so the next sign-in grants the scopes the app asks for now.
 */
export async function acknowledgeAndSignOut(id: string) {
  const session = await authClient.getSession();

  if (session.data) {
    await parseResponse(apiClient.notifications[":id"].acknowledge.$post({ param: { id } }));
    await authClient.signOut();
    queryClient.clear();
  }

  await signInWithSpotify("/");
}
