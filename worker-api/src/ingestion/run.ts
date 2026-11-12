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
import { INGESTION_EVENTS, logIngestionEvent } from "./events.ts";
import { storePlays } from "./plays.ts";
import { createSpotifyClient, getSpotifyQuotaError } from "./spotify.ts";

/**
 * Spotify caps the page at 50, and one page must cover a full gap between Cron
 * Trigger runs. A smaller page loses plays: the cursor moves to the newest play
 * in the page, so older plays before it are never fetched.
 */
const FETCH_LIMIT = 50;

type SpotifyAccount = Awaited<ReturnType<typeof findSpotifyAccounts>>[number];

type AccountResult = {
  /** Plays that reached `storePlays`, including plays that already existed. */
  plays: number;
  /** False when the account was skipped or failed without throwing. */
  ok: boolean;
};

/**
 * Fetch and store recent plays for every Spotify account.
 *
 * Accounts are processed in order and each one is isolated: a failure is logged
 * and the loop continues. The cursor is not advanced for a failed account, so
 * the next run retries it.
 *
 * A quota error (HTTP 429) stops the whole run. All accounts use the same
 * application quota, so the next account would fail the same way. The next
 * Cron Trigger run tries again five minutes later, and the block lasts until
 * Spotify resets the quota. A block that covers more plays than one page loses
 * the plays between the old cursor and the newest play of the page.
 *
 * Each run logs one `runComplete` event and one event per account, because the
 * invocation outcome stays `ok` for every error that this function catches.
 */
export async function runIngestion(
  env: WorkerEnv,
  createClient: CreateSpotifyClient = (accessToken) => createSpotifyClient(env, accessToken),
) {
  const db = createDatabase(env.DB);
  const auth = createAuth(env);
  const accounts = await findSpotifyAccounts(db);
  const seenUsers = new Set<string>();

  let plays = 0;
  let failures = 0;

  for (const account of accounts) {
    // A user must have exactly one Spotify account. Keep the first row and
    // skip any duplicate.
    if (seenUsers.has(account.userId)) {
      continue;
    }

    seenUsers.add(account.userId);

    try {
      const result = await ingestAccount(db, auth, account, createClient);

      plays += result.plays;

      if (!result.ok) {
        failures += 1;
      }
    } catch (error) {
      const quota = error instanceof Error ? getSpotifyQuotaError(error) : null;

      if (quota) {
        logIngestionEvent("error", {
          event: INGESTION_EVENTS.quotaExhausted,
          userId: account.userId,
          retryAfterSeconds: quota.retryAfterSeconds,
          accounts: seenUsers.size,
          plays,
        });
        logIngestionEvent("info", {
          event: INGESTION_EVENTS.runComplete,
          status: "quota",
          accounts: seenUsers.size,
          plays,
          failures,
        });

        return;
      }

      failures += 1;

      logIngestionEvent("error", {
        event: INGESTION_EVENTS.accountFailed,
        userId: account.userId,
        errorName: error instanceof Error ? error.name : "NonError",
        errorMessage: error instanceof Error ? error.message : String(error),
      });
    }
  }

  logIngestionEvent("info", {
    event: INGESTION_EVENTS.runComplete,
    status: failures === 0 ? "ok" : "partial",
    accounts: seenUsers.size,
    plays,
    failures,
  });
}

/**
 * Ingest one account: fetch the plays after the stored cursor, store them, then
 * move the cursor to the newest play. A run without a cursor fetches the newest
 * page instead.
 *
 * A skipped account returns instead of throwing, so it cannot stop the other
 * accounts.
 */
async function ingestAccount(
  db: Database,
  auth: Auth,
  account: SpotifyAccount,
  createClient: CreateSpotifyClient,
): Promise<AccountResult> {
  // Better Auth selects the account row by its local ID.
  const token = await auth.api.getAccessToken({
    body: { accountId: account.id, userId: account.userId },
  });

  if (!token?.accessToken) {
    logIngestionEvent("error", {
      event: INGESTION_EVENTS.tokenMissing,
      userId: account.userId,
    });

    return { plays: 0, ok: false };
  }

  const queueData = await findUserQueueDataById(db, account.userId);

  if (!queueData) {
    logIngestionEvent("warn", {
      event: INGESTION_EVENTS.userMissing,
      userId: account.userId,
    });

    return { plays: 0, ok: false };
  }

  const { lastRecentTracksFetchTime } = queueData;
  const client = createClient(token.accessToken);

  const page = lastRecentTracksFetchTime
    ? await client.getRecentlyPlayedTracks(FETCH_LIMIT, {
        type: "after",
        timestamp: lastRecentTracksFetchTime.getTime(),
      })
    : await client.getRecentlyPlayedTracks(FETCH_LIMIT);

  const scrobbleDates = await storePlays(db, account.userId, page.items);

  let mostRecentScrobbleDate: Date | null = null;

  for (const scrobbleDate of scrobbleDates) {
    if (!mostRecentScrobbleDate || scrobbleDate > mostRecentScrobbleDate) {
      mostRecentScrobbleDate = scrobbleDate;
    }
  }

  if (mostRecentScrobbleDate) {
    await updateLastRecentTracksFetchTime(db, account.userId, mostRecentScrobbleDate);
  } else if (lastRecentTracksFetchTime) {
    // No new plays after the cursor: move it to now so the next fetch asks
    // only for plays after this point.
    await updateLastRecentTracksFetchTime(db, account.userId, new Date());
  }

  logIngestionEvent("info", {
    event: INGESTION_EVENTS.accountIngested,
    userId: account.userId,
    plays: scrobbleDates.length,
  });

  return { plays: scrobbleDates.length, ok: true };
}
