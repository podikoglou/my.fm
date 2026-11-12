import type { WorkerEnv } from "../alchemy.ts";
import type { Auth } from "../auth.ts";
import type { Database } from "../db/index.ts";
import type { CreateSpotifyClient } from "./spotify.ts";

import { createAuth } from "../auth.ts";
import { createDatabase } from "../db/index.ts";
import {
  findSpotifyAccounts,
  findUserQueueDataById,
  updateLastRecentTracksFetchTime,
} from "../db/queries/users.ts";
import { storePlays } from "./plays.ts";
import { createSpotifyClient } from "./spotify.ts";

/** Spotify caps the page at 50, so the first fetch asks for the maximum. */
const FETCH_LIMIT_INITIAL = 50;

/** The Cron Trigger runs every minute, so a small page covers the gap. */
const FETCH_LIMIT_REGULAR = 6;

type SpotifyAccount = Awaited<ReturnType<typeof findSpotifyAccounts>>[number];

/**
 * Fetch and store recent plays for every Spotify account.
 *
 * Accounts are processed in order and each one is isolated: a failure is logged
 * and the loop continues. The cursor is not advanced for a failed account, so
 * the next run retries it.
 */
export async function runIngestion(
  env: WorkerEnv,
  createClient: CreateSpotifyClient = (accessToken) => createSpotifyClient(env, accessToken),
) {
  const db = createDatabase(env.DB);
  const auth = createAuth(env);
  const accounts = await findSpotifyAccounts(db);
  const seenUsers = new Set<string>();

  for (const account of accounts) {
    // A user must have exactly one Spotify account. Keep the first row and
    // skip any duplicate.
    if (seenUsers.has(account.userId)) {
      continue;
    }

    seenUsers.add(account.userId);

    try {
      await ingestAccount(db, auth, account, createClient);
    } catch (error) {
      console.error(`Spotify ingestion failed for user ${account.userId}`, error);
    }
  }
}

/**
 * Ingest one account: fetch the plays after the stored cursor, store them, then
 * move the cursor to the newest play. The first run has no cursor and fetches a
 * full page instead.
 */
async function ingestAccount(
  db: Database,
  auth: Auth,
  account: SpotifyAccount,
  createClient: CreateSpotifyClient,
) {
  // Better Auth selects the account row by its local ID.
  const token = await auth.api.getAccessToken({
    body: { accountId: account.id, userId: account.userId },
  });

  if (!token?.accessToken) {
    console.error(`No Spotify access token for user ${account.userId}`);

    return;
  }

  const queueData = await findUserQueueDataById(db, account.userId);

  if (!queueData) {
    console.warn(`Spotify account owner ${account.userId} disappeared`);

    return;
  }

  const { lastRecentTracksFetchTime } = queueData;
  const client = createClient(token.accessToken);

  const plays = lastRecentTracksFetchTime
    ? await client.getRecentlyPlayedTracks(FETCH_LIMIT_REGULAR, {
        type: "after",
        timestamp: lastRecentTracksFetchTime.getTime(),
      })
    : await client.getRecentlyPlayedTracks(FETCH_LIMIT_INITIAL);

  let mostRecentScrobbleDate: Date | null = null;

  for (const scrobbleDate of await storePlays(db, account.userId, plays.items)) {
    if (!mostRecentScrobbleDate || scrobbleDate > mostRecentScrobbleDate) {
      mostRecentScrobbleDate = scrobbleDate;
    }
  }

  if (mostRecentScrobbleDate) {
    await updateLastRecentTracksFetchTime(db, account.userId, mostRecentScrobbleDate);
  } else if (lastRecentTracksFetchTime) {
    // No new plays after the cursor: move it to now so the next fetch uses
    // the regular limit.
    await updateLastRecentTracksFetchTime(db, account.userId, new Date());
  }
}
