import type { WorkerEnv } from "../alchemy.ts";
import type { Auth } from "../auth.ts";
import type { Database } from "../db/index.ts";
import type { CreateSpotifyClient } from "./spotify.ts";

import { createAuth } from "../auth.ts";
import { createDatabase } from "../db/index.ts";
import { findIngestionRun, recordIngestionRun } from "../db/queries/ingestionRuns.ts";
import {
  findSpotifyAccounts,
  findUserQueueDataById,
  updateLastRecentTracksFetchTime,
} from "../db/queries/users.ts";
import {
  INGESTION_EVENTS,
  logIngestionEvent,
  logIngestionFailure,
  logIngestionWarning,
} from "./events.ts";
import { storePlays } from "./plays.ts";
import { createSpotifyClient, getSpotifyQuotaError } from "./spotify.ts";

/**
 * Spotify caps the page at 50, and one page must cover a full gap between Cron
 * Trigger runs. A smaller page loses plays: the cursor moves to the newest play
 * in the page, so older plays before it are never fetched.
 */
const FETCH_LIMIT = 50;

type SpotifyAccount = Awaited<ReturnType<typeof findSpotifyAccounts>>[number];

/**
 * How long after the last run the schedule counts as stopped. The Cron Trigger
 * runs every five minutes, so four missed runs is an outage rather than a slow
 * start.
 */
export const INGESTION_STALE_AFTER_MS = 20 * 60_000;

/**
 * What to wait when Spotify blocks the application but sends no reset time.
 * Long enough to stop a retry storm, short enough to notice an early reset.
 */
const BLOCK_FALLBACK_SECONDS = 30 * 60;

/**
 * The longest wait that a block may cause. A wrong reset time must not stop
 * ingestion for days, and one request a day costs almost nothing.
 */
const BLOCK_MAX_SECONDS = 24 * 60 * 60;

/**
 * The end of a Spotify block and the wait that leads to it.
 *
 * Spotify sends the reset time in `Retry-After`. A block lasts until that one
 * instant, so a run before it spends a request and fails again. The value can
 * also be absent, because the SDK drops the headers on some errors.
 */
function blockWindow(now: Date, retryAfterSeconds: number | null) {
  const seconds = Math.min(retryAfterSeconds ?? BLOCK_FALLBACK_SECONDS, BLOCK_MAX_SECONDS);

  return { until: new Date(now.getTime() + seconds * 1000), seconds };
}

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
 * A quota error (HTTP 429) stops the whole run, because all accounts share one
 * application quota. The end of the block goes on the heartbeat, and every run
 * before that instant returns without a request. Spotify cannot return the
 * plays from a block, so a run inside it only spends quota.
 *
 * Each run logs one `runComplete` event and one event per account, because the
 * invocation outcome stays `ok` for every error that this function catches.
 */
export async function runIngestion(
  env: WorkerEnv,
  createClient: CreateSpotifyClient = (accessToken) => createSpotifyClient(env, accessToken),
) {
  const db = createDatabase(env.DB);
  const now = new Date();
  const previous = await findIngestionRun(db);

  if (previous?.blockedUntil && previous.blockedUntil > now) {
    // The first blocked run reported the block. Repeating the error every five
    // minutes would bury that report in its own noise.
    logIngestionEvent({
      event: INGESTION_EVENTS.runSkipped,
      retryAfterSeconds: Math.ceil((previous.blockedUntil.getTime() - now.getTime()) / 1000),
    });
    await recordIngestionRun(db, {
      at: now,
      status: "quota",
      blockedUntil: previous.blockedUntil,
    });

    return;
  }

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
        const block = blockWindow(new Date(), quota.retryAfterSeconds);

        logIngestionFailure(INGESTION_EVENTS.quotaExhausted);
        await recordIngestionRun(db, {
          at: new Date(),
          status: "quota",
          blockedUntil: block.until,
        });
        logIngestionEvent({
          event: INGESTION_EVENTS.runComplete,
          status: "quota",
          accounts: seenUsers.size,
          plays,
          failures,
          retryAfterSeconds: block.seconds,
        });

        return;
      }

      failures += 1;

      logIngestionFailure(
        INGESTION_EVENTS.accountFailed,
        error instanceof Error ? error : String(error),
      );
    }
  }

  const status = failures === 0 ? "ok" : "partial";

  logIngestionEvent({
    event: INGESTION_EVENTS.runComplete,
    status,
    accounts: seenUsers.size,
    plays,
    failures,
  });

  await recordIngestionRun(db, { at: new Date(), status });
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
    logIngestionFailure(INGESTION_EVENTS.tokenMissing, account.userId);

    return { plays: 0, ok: false };
  }

  const queueData = await findUserQueueDataById(db, account.userId);

  if (!queueData) {
    logIngestionWarning(INGESTION_EVENTS.userMissing, account.userId);

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

  logIngestionEvent({
    event: INGESTION_EVENTS.accountIngested,
    userId: account.userId,
    plays: scrobbleDates.length,
  });

  return { plays: scrobbleDates.length, ok: true };
}
