import type { WorkerEnv } from "../alchemy.ts";
import type { Auth } from "../auth.ts";
import type { Database } from "../db/index.ts";
import type { CreateSpotifyClient } from "./spotify.ts";

import { createAuth } from "../auth.ts";
import { describeError, getD1QuotaError } from "../db/errors.ts";
import { createDatabase } from "../db/index.ts";
import { findIngestionRun, recordIngestionRun } from "../db/queries/ingestionRuns.ts";
import {
  findSpotifyAccounts,
  findUserQueueDataById,
  updateUserFetchState,
  type UserFetchStateUpdate,
} from "../db/queries/users.ts";
import {
  INGESTION_EVENTS,
  d1QuotaEventName,
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
 * runs every minute, so twenty missed runs is an outage rather than a slow
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

export const INGESTION_CONFIG = {
  /** How often to fetch Spotify for an active user (ms). */
  activeIntervalMs: 3 * 60_000,
  /** How often to fetch Spotify for an inactive user (ms). */
  inactiveIntervalMs: 10 * 60_000,
  /** How long a user remains in the active group after recent playback (ms). */
  activeWindowMs: 15 * 60_000,
} as const;

export type IngestionConfig = typeof INGESTION_CONFIG;

export function shouldFetchUser(
  user: {
    lastFetchedAt?: Date | null;
    lastActiveAt?: Date | null;
    lastRecentTracksFetchTime?: Date | null;
  },
  now: Date,
  config: IngestionConfig = INGESTION_CONFIG,
): boolean {
  if (!user.lastFetchedAt || !user.lastRecentTracksFetchTime) {
    return true;
  }

  const timeSinceLastFetch = now.getTime() - user.lastFetchedAt.getTime();

  const isActive =
    user.lastActiveAt != null &&
    now.getTime() - user.lastActiveAt.getTime() < config.activeWindowMs;

  const intervalMs = isActive ? config.activeIntervalMs : config.inactiveIntervalMs;

  return timeSinceLastFetch >= intervalMs;
}

type AccountResult = {
  /** Plays that reached `storePlays`, including plays that already existed. */
  plays: number;
  /** False when the account was skipped or failed without throwing. */
  ok: boolean;
  skipped?: boolean;
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
 *
 * A D1 daily-limit error stops the run the same way but leaves no heartbeat:
 * every write fails until midnight UTC, so the run reports one stable event
 * and waits for the next cron trigger.
 */
export async function runIngestion(
  env: WorkerEnv,
  createClient: CreateSpotifyClient = (accessToken) => createSpotifyClient(env, accessToken),
  now: Date = new Date(),
) {
  try {
    await ingestAllAccounts(env, createClient, now);
  } catch (error) {
    const quota = error instanceof Error ? getD1QuotaError(error) : null;

    if (!quota) {
      throw error;
    }

    // No heartbeat follows: the write would fail with the same error. The
    // next cron run retries, and midnight UTC ends the limit by itself.
    logIngestionFailure(d1QuotaEventName(quota.limit));
  }
}

/** One cron tick of ingestion, without the D1-limit envelope. */
async function ingestAllAccounts(env: WorkerEnv, createClient: CreateSpotifyClient, now: Date) {
  const db = createDatabase(env.DB);
  const previous = await findIngestionRun(db);

  if (previous?.blockedUntil && previous.blockedUntil > now) {
    // The first blocked run reported the block. Repeating the error on every
    // run would bury that report in its own noise.
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
  let attemptedAccounts = 0;

  for (const account of accounts) {
    // A user must have exactly one Spotify account. Keep the first row and
    // skip any duplicate.
    if (seenUsers.has(account.userId)) {
      continue;
    }

    seenUsers.add(account.userId);

    try {
      const result = await ingestAccount(db, auth, account, createClient, now);

      if (result.skipped) {
        continue;
      }

      attemptedAccounts += 1;
      plays += result.plays;

      if (!result.ok) {
        failures += 1;
      }
    } catch (error) {
      const d1Quota = error instanceof Error ? getD1QuotaError(error) : null;

      if (d1Quota) {
        // The limit is account-wide, so the next account would fail the same
        // way, and the heartbeat write at the end would fail with it.
        logIngestionFailure(d1QuotaEventName(d1Quota.limit));

        return;
      }

      attemptedAccounts += 1;
      const quota = error instanceof Error ? getSpotifyQuotaError(error) : null;

      if (quota) {
        const block = blockWindow(now, quota.retryAfterSeconds);

        logIngestionFailure(INGESTION_EVENTS.quotaExhausted);
        await recordIngestionRun(db, {
          at: now,
          status: "quota",
          blockedUntil: block.until,
        });
        logIngestionEvent({
          event: INGESTION_EVENTS.runComplete,
          status: "quota",
          accounts: attemptedAccounts,
          plays,
          failures,
          retryAfterSeconds: block.seconds,
        });

        return;
      }

      failures += 1;

      logIngestionFailure(
        INGESTION_EVENTS.accountFailed,
        error instanceof Error ? describeError(error) : String(error),
      );
    }
  }

  const status = failures === 0 ? "ok" : "partial";

  logIngestionEvent({
    event: INGESTION_EVENTS.runComplete,
    status,
    accounts: attemptedAccounts,
    plays,
    failures,
  });

  await recordIngestionRun(db, { at: now, status });
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
  now: Date,
): Promise<AccountResult> {
  const queueData = await findUserQueueDataById(db, account.userId);

  if (!queueData) {
    logIngestionWarning(INGESTION_EVENTS.userMissing, account.userId);

    return { plays: 0, ok: false };
  }

  if (!shouldFetchUser(queueData, now)) {
    return { plays: 0, ok: true, skipped: true };
  }

  // Better Auth selects the account row by its local ID.
  const token = await auth.api.getAccessToken({
    body: { accountId: account.id, userId: account.userId },
  });

  if (!token?.accessToken) {
    logIngestionFailure(INGESTION_EVENTS.tokenMissing, account.userId);

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

  const isRecentPlay =
    mostRecentScrobbleDate !== null &&
    now.getTime() - mostRecentScrobbleDate.getTime() <= INGESTION_CONFIG.activeWindowMs;

  const nextCursor = mostRecentScrobbleDate ?? queueData.lastRecentTracksFetchTime ?? now;

  const update: UserFetchStateUpdate = {
    lastFetchedAt: now,
    lastRecentTracksFetchTime: nextCursor,
  };

  if (isRecentPlay) {
    update.lastActiveAt = now;
  }

  await updateUserFetchState(db, account.userId, update);

  logIngestionEvent({
    event: INGESTION_EVENTS.accountIngested,
    userId: account.userId,
    plays: scrobbleDates.length,
  });

  return { plays: scrobbleDates.length, ok: true, skipped: false };
}
