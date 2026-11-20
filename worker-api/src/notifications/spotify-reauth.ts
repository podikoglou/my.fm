import { sql } from "drizzle-orm";

import type { Database } from "../db/index.ts";
import type { User } from "../db/schema.ts";

export const SPOTIFY_REAUTH_TYPE = "spotify-reauth";

/** The scope that grants from before the app asked for it are missing. */
export const SPOTIFY_REAUTH_SCOPE = "user-read-currently-playing";

const TITLE = "Reconnect your Spotify account";

const BODY =
  "my.fm can now show what you are playing, but your Spotify sign-in is older than that. Click here to sign out, then sign in with Spotify again to allow it.";

/**
 * Notify the user when their stored Spotify grant lacks the scope. A partial
 * unique index keeps one unacknowledged notification per user, so this is safe
 * to run on every request.
 */
export async function createSpotifyReauthNotification(db: Database, userId: User["id"]) {
  // Better Auth stores scopes comma-separated; Spotify returns them space-separated.
  await db.run(sql`
    insert into notifications (userId, type, title, body)
    select user_id, ${SPOTIFY_REAUTH_TYPE}, ${TITLE}, ${BODY}
    from accounts
    where user_id = ${userId}
      and provider_id = 'spotify'
      and instr(',' || replace(coalesce(scope, ''), ' ', ',') || ',', ${`,${SPOTIFY_REAUTH_SCOPE},`}) = 0
    on conflict do nothing
  `);
}
