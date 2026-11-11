import type { WorkerEnv } from "../../alchemy.run.ts";

import type { Auth } from "../auth.ts";
import { createAuth } from "../auth.ts";
import type { Database } from "../db/index.ts";
import { createDatabase } from "../db/index.ts";
import {
  findSpotifyAccounts,
  findUserQueueDataById,
  updateLastRecentTracksFetchTime,
} from "../db/queries/users.ts";

import { storePlay } from "./plays.ts";
import type { CreateSpotifyClient } from "./spotify.ts";
import { createSpotifyClient } from "./spotify.ts";

const FETCH_LIMIT_INITIAL = 50;
const FETCH_LIMIT_REGULAR = 6;

type SpotifyAccount = Awaited<ReturnType<typeof findSpotifyAccounts>>[number];

/**
 * Fetch recently played tracks for every Spotify account and store them.
 *
 * The Bun scheduler rotated one user through an in-memory queue every five
 * seconds. A Worker has no long-lived queue, so each Cron Trigger run scans the
 * Spotify accounts and processes them in order. The per-user fetch logic,
 * limits, and cursor updates are unchanged.
 *
 * A failure for one account is logged and does not stop the other accounts.
 * The cursor is not advanced for the failed user, so the next run retries it.
 */
export async function runIngestion(
  env: WorkerEnv,
  createClient: CreateSpotifyClient = (accessToken) => createSpotifyClient(env, accessToken),
) {
  const db = createDatabase(env.DB);
  const auth = createAuth(env);
  const accounts = await findSpotifyAccounts(db);

  for (const account of accounts) {
    try {
      await ingestAccount(db, auth, account, createClient);
    } catch (error) {
      console.error(`Spotify ingestion failed for user ${account.userId}`, error);
    }
  }
}

async function ingestAccount(
  db: Database,
  auth: Auth,
  account: SpotifyAccount,
  createClient: CreateSpotifyClient,
) {
  // Better Auth 1.7.20 selects the account by its local ID. The Bun API used
  // `providerId`; the account row and its refresh behaviour are the same.
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

  for (const play of plays.items) {
    const scrobbleDate = await storePlay(db, account.userId, play);

    if (!mostRecentScrobbleDate || scrobbleDate > mostRecentScrobbleDate) {
      mostRecentScrobbleDate = scrobbleDate;
    }
  }

  if (mostRecentScrobbleDate) {
    await updateLastRecentTracksFetchTime(db, account.userId, mostRecentScrobbleDate);
  } else if (lastRecentTracksFetchTime) {
    // No new plays after the cursor: move it to now so the next fetch uses the
    // regular limit, as the Bun scheduler does.
    await updateLastRecentTracksFetchTime(db, account.userId, new Date());
  }
}
