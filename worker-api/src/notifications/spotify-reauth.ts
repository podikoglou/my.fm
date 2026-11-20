import { sql } from "drizzle-orm";

import type { Database } from "../db/index.ts";
import type { User } from "../db/schema.ts";

export const SPOTIFY_REAUTH_TYPE = "spotify-reauth";

/** The scope that grants from before the app asked for it are missing. */
export const SPOTIFY_REAUTH_SCOPE = "user-read-currently-playing";

const TITLE = "Reconnect your Spotify account";

const BODY =
  "my.fm can now show what you are playing, but your Spotify sign-in is older than that. Click here to sign out, then sign in with Spotify again to allow it.";

// Better Auth stores scopes comma-separated; Spotify returns them space-separated.
const lacksScope = sql`instr(',' || replace(coalesce(scope, ''), ' ', ',') || ',', ${`,${SPOTIFY_REAUTH_SCOPE},`}) = 0`;

/**
 * Keep the user's reauthorization notice in line with their stored Spotify
 * grant: create it while the grant lacks the scope, and acknowledge it once
 * the grant has it. A partial unique index keeps one unacknowledged notice per
 * user, so this is safe to run on every request.
 */
export async function syncSpotifyReauthNotification(
  db: Database,
  userId: User["id"],
  now = new Date(),
) {
  await db.run(sql`
    insert into notifications (userId, type, title, body)
    select user_id, ${SPOTIFY_REAUTH_TYPE}, ${TITLE}, ${BODY}
    from accounts
    where user_id = ${userId} and provider_id = 'spotify' and ${lacksScope}
    on conflict do nothing
  `);

  await db.run(sql`
    update notifications
    set acknowledgedAt = ${now.getTime()}
    where userId = ${userId}
      and type = ${SPOTIFY_REAUTH_TYPE}
      and acknowledgedAt is null
      and not exists (
        select 1 from accounts
        where user_id = ${userId} and provider_id = 'spotify' and ${lacksScope}
      )
  `);
}
