import { KeyRound } from "lucide-react";

import type { Notification } from "~/lib/notifications";

import { Alert, AlertDescription, AlertTitle } from "~/components/ui/alert";
import { authClient } from "~/lib/auth";
import { signInWithSpotify } from "~/lib/auth-guard";
import { markNotificationAcknowledged } from "~/lib/notifications";
import { queryClient } from "~/lib/query";

import type { NotificationKind } from "./kind";

function SpotifyReauthNotificationContent({ notification }: { notification: Notification }) {
  return (
    // The list's link carries the semantics; a persistent notice is not an alert.
    <Alert role={undefined} className="transition-colors hover:bg-muted/50">
      <KeyRound />
      <AlertTitle>{notification.title}</AlertTitle>
      <AlertDescription>{notification.body}</AlertDescription>
    </Alert>
  );
}

/**
 * The stored Spotify grant lacks a scope the app now asks for. Signing out and
 * back in grants it, so acknowledging ends the session and starts sign-in.
 */
export const spotifyReauthNotificationKind: NotificationKind = {
  Content: SpotifyReauthNotificationContent,
  async acknowledge({ id }) {
    await markNotificationAcknowledged(id);
    await authClient.signOut();
    queryClient.clear();
    await signInWithSpotify("/");

    return null;
  },
};
