import { Clock, Context, Effect, Layer, Predicate } from "effect";

import { AuthService, type AuthError } from "../auth/service.ts";
import { classifyDbError, type D1QueryError, type D1QuotaExceededError } from "../db/errors.ts";
import type { DatabaseRequirements } from "../db/service.ts";
import { findIngestionRun, recordIngestionRun } from "../db/queries/ingestionRuns.ts";
import {
  findSpotifyAccounts,
  findUserQueueDataById,
  updateUserFetchState,
  type UserFetchStateUpdate,
} from "../db/queries/users.ts";
import { D1Client } from "@effect/sql-d1";
import { SqlClient } from "effect/sql";
import { Scrobbles } from "../scrobbles/service.ts";
import type { SpotifyQuotaExceededError } from "../spotify/errors.ts";
import { SpotifyClient } from "../spotify/service.ts";
import { INGESTION_EVENTS, logIngestionEvent, logIngestionFailure } from "./events.ts";
import {
  ACTIVE_WINDOW_MS,
  computeQuotaBlock,
  isUserActive,
  shouldFetchHistory,
  shouldFetchUser,
  toPlayRecord,
} from "./schedule.ts";

export interface IngestionApi {
  readonly run: (now?: Date) => Effect.Effect<void>;
}

const RECENTLY_PLAYED_LIMIT = 50;

type AccountOutcome =
  | { readonly kind: "ok"; readonly plays: number; readonly skipped: boolean }
  | { readonly kind: "failed" }
  | { readonly kind: "spotify-quota"; readonly error: SpotifyQuotaExceededError }
  | { readonly kind: "d1-quota"; readonly error: D1QuotaExceededError };

function logD1Quota(error: D1QuotaExceededError): Effect.Effect<void> {
  const event =
    error.limit === "row-read" ? INGESTION_EVENTS.d1ReadLimit : INGESTION_EVENTS.d1WriteLimit;

  return logIngestionFailure(event, error);
}

function deduplicateByUserId<T extends { readonly userId: string }>(
  accounts: ReadonlyArray<T>,
): T[] {
  const seen = new Set<string>();
  const unique: T[] = [];

  for (const account of accounts) {
    if (seen.has(account.userId)) {
      continue;
    }

    seen.add(account.userId);
    unique.push(account);
  }

  return unique;
}

export class Ingestion extends Context.Service<Ingestion, IngestionApi>()(
  "@my.fm/api/ingestion/Ingestion",
) {
  static readonly layer: Layer.Layer<
    Ingestion,
    never,
    DatabaseRequirements | AuthService | Scrobbles | SpotifyClient
  > = Layer.effect(
    Ingestion,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const d1 = yield* D1Client.D1Client;
      const auth = yield* AuthService;
      const scrobbles = yield* Scrobbles;
      const spotify = yield* SpotifyClient;

      const recordHeartbeatSafe = Effect.fn("Ingestion.recordHeartbeatSafe")(function* (values: {
        readonly at: Date;
        readonly status: "ok" | "partial" | "quota";
        readonly blockedUntil?: Date | null;
      }) {
        yield* recordIngestionRun(values).pipe(
          Effect.catchTag("D1QuotaExceededError", (error) => logD1Quota(error)),
          Effect.catchTag("D1QueryError", (error) => Effect.die(error)),
        );
      });

      const ingestAccount = Effect.fn("Ingestion.ingestAccount")(function* (
        account: { readonly id: string; readonly userId: string },
        now: Date,
      ): Effect.fn.Return<AccountOutcome, never, DatabaseRequirements> {
        type QueueResult =
          | {
              readonly ok: true;
              readonly data: Effect.Success<ReturnType<typeof findUserQueueDataById>>;
            }
          | { readonly ok: false; readonly kind: "d1-quota"; readonly error: D1QuotaExceededError }
          | { readonly ok: false; readonly kind: "error"; readonly error: D1QueryError };

        const queueData: QueueResult = yield* findUserQueueDataById(account.userId).pipe(
          Effect.map((data): QueueResult => ({ ok: true, data })),
          Effect.catchTag("D1QuotaExceededError", (error) =>
            Effect.succeed<QueueResult>({ ok: false, kind: "d1-quota", error }),
          ),
          Effect.catchTag("D1QueryError", (error) =>
            Effect.succeed<QueueResult>({ ok: false, kind: "error", error }),
          ),
        );

        if (!queueData.ok) {
          if (queueData.kind === "d1-quota") {
            return { kind: "d1-quota", error: queueData.error };
          }

          yield* logIngestionFailure(
            INGESTION_EVENTS.accountFailed,
            account.userId,
            queueData.error,
          );

          return { kind: "failed" };
        }

        if (!queueData.data) {
          yield* logIngestionFailure(INGESTION_EVENTS.userMissing, account.userId);

          return { kind: "failed" };
        }

        const userState = queueData.data;
        const active = isUserActive(userState.lastActiveAt, now);

        if (!active && !shouldFetchUser(userState, now)) {
          return { kind: "ok", plays: 0, skipped: true };
        }

        type TokenResult =
          | { readonly ok: true; readonly accessToken: string | null }
          | { readonly ok: false; readonly kind: "d1-quota"; readonly error: D1QuotaExceededError }
          | { readonly ok: false; readonly kind: "error"; readonly error: AuthError };

        const tokenResult: TokenResult = yield* auth
          .getAccessToken({ accountId: account.id, userId: account.userId })
          .pipe(
            Effect.map((accessToken): TokenResult => ({ ok: true, accessToken })),
            Effect.catchTag("AuthError", (error) => {
              if (error.cause instanceof Error) {
                const dbError = classifyDbError(error.cause);

                if (Predicate.isTagged(dbError, "D1QuotaExceededError")) {
                  return Effect.succeed<TokenResult>({
                    ok: false,
                    kind: "d1-quota",
                    error: dbError,
                  });
                }
              }

              return Effect.succeed<TokenResult>({ ok: false, kind: "error", error });
            }),
          );

        if (!tokenResult.ok) {
          if (tokenResult.kind === "d1-quota") {
            return { kind: "d1-quota", error: tokenResult.error };
          }

          yield* logIngestionFailure(
            INGESTION_EVENTS.accountFailed,
            account.userId,
            tokenResult.error,
          );

          return { kind: "failed" };
        }

        if (!tokenResult.accessToken) {
          yield* logIngestionFailure(INGESTION_EVENTS.tokenMissing, account.userId);

          return { kind: "failed" };
        }

        const client = spotify.forAccessToken(tokenResult.accessToken);

        let playback = null;

        if (active) {
          const playbackResult = yield* client.getCurrentlyPlaying().pipe(
            Effect.map((value) => ({ ok: true as const, value })),
            Effect.catchTag("SpotifyQuotaExceededError", (error) =>
              Effect.succeed({ ok: false as const, error }),
            ),
          );

          if (!playbackResult.ok) {
            return { kind: "spotify-quota", error: playbackResult.error };
          }

          playback = playbackResult.value;
        }

        if (!shouldFetchHistory(userState, playback, now)) {
          return { kind: "ok", plays: 0, skipped: true };
        }

        const cursor = userState.lastRecentTracksFetchTime;

        const pageResult = yield* client
          .getRecentlyPlayedTracks(
            RECENTLY_PLAYED_LIMIT,
            cursor ? { type: "after", timestamp: cursor.getTime() } : undefined,
          )
          .pipe(
            Effect.map((page) => ({ ok: true as const, items: page.items })),
            Effect.catchTag("SpotifyQuotaExceededError", (error) =>
              Effect.succeed({ ok: false as const, kind: "spotify-quota" as const, error }),
            ),
            Effect.catchTag("SpotifyClientError", (error) =>
              Effect.succeed({ ok: false as const, kind: "error" as const, error }),
            ),
          );

        if (!pageResult.ok) {
          if (pageResult.kind === "spotify-quota") {
            return { kind: "spotify-quota", error: pageResult.error };
          }

          yield* logIngestionFailure(
            INGESTION_EVENTS.accountFailed,
            account.userId,
            pageResult.error,
          );

          return { kind: "failed" };
        }

        const plays = pageResult.items;

        const recordsResult = yield* Effect.tryPromise({
          try: () => Promise.all(plays.map((play) => toPlayRecord(account.userId, play))),
          catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
        }).pipe(
          Effect.map((records) => ({ ok: true as const, records })),
          Effect.catch((error) => Effect.succeed({ ok: false as const, error })),
        );

        if (!recordsResult.ok) {
          yield* logIngestionFailure(
            INGESTION_EVENTS.accountFailed,
            account.userId,
            recordsResult.error,
          );

          return { kind: "failed" };
        }

        const { records } = recordsResult;

        type WriteResult =
          | { readonly ok: true }
          | { readonly ok: false; readonly kind: "d1-quota"; readonly error: D1QuotaExceededError }
          | { readonly ok: false; readonly kind: "error"; readonly error: D1QueryError };

        const persistResult: WriteResult = yield* scrobbles.persistPlays(records).pipe(
          Effect.as<WriteResult>({ ok: true }),
          Effect.catchTag("D1QuotaExceededError", (error) =>
            Effect.succeed<WriteResult>({ ok: false, kind: "d1-quota", error }),
          ),
          Effect.catchTag("D1QueryError", (error) =>
            Effect.succeed<WriteResult>({ ok: false, kind: "error", error }),
          ),
        );

        if (!persistResult.ok) {
          if (persistResult.kind === "d1-quota") {
            return { kind: "d1-quota", error: persistResult.error };
          }

          yield* logIngestionFailure(
            INGESTION_EVENTS.accountFailed,
            account.userId,
            persistResult.error,
          );

          return { kind: "failed" };
        }

        let newestPlayDate: Date | null = null;
        let hasRecentPlay = false;

        for (const record of records) {
          const date = record.scrobbleDate;

          if (!date) {
            continue;
          }

          if (!newestPlayDate || date.getTime() > newestPlayDate.getTime()) {
            newestPlayDate = date;
          }

          if (now.getTime() - date.getTime() < ACTIVE_WINDOW_MS) {
            hasRecentPlay = true;
          }
        }

        const nextCursor = newestPlayDate ?? cursor ?? now;

        const update: UserFetchStateUpdate = hasRecentPlay
          ? {
              lastFetchedAt: now,
              lastRecentTracksFetchTime: nextCursor,
              lastActiveAt: now,
            }
          : {
              lastFetchedAt: now,
              lastRecentTracksFetchTime: nextCursor,
            };

        const updateResult: WriteResult = yield* updateUserFetchState(account.userId, update).pipe(
          Effect.as<WriteResult>({ ok: true }),
          Effect.catchTag("D1QuotaExceededError", (error) =>
            Effect.succeed<WriteResult>({ ok: false, kind: "d1-quota", error }),
          ),
          Effect.catchTag("D1QueryError", (error) =>
            Effect.succeed<WriteResult>({ ok: false, kind: "error", error }),
          ),
        );

        if (!updateResult.ok) {
          if (updateResult.kind === "d1-quota") {
            return { kind: "d1-quota", error: updateResult.error };
          }

          yield* logIngestionFailure(
            INGESTION_EVENTS.accountFailed,
            account.userId,
            updateResult.error,
          );

          return { kind: "failed" };
        }

        yield* logIngestionEvent({
          event: INGESTION_EVENTS.accountIngested,
          userId: account.userId,
          plays: plays.length,
        });

        return { kind: "ok", plays: plays.length, skipped: false };
      });

      const run = Effect.fn("Ingestion.run")(function* (nowOverride?: Date) {
        const nowMs = yield* Clock.currentTimeMillis;
        const now = nowOverride ?? new Date(nowMs);

        const previousResult = yield* findIngestionRun().pipe(
          Effect.map((value) => ({ ok: true as const, value })),
          Effect.catchTag("D1QuotaExceededError", (error) =>
            Effect.succeed({ ok: false as const, error }),
          ),
          Effect.catchTag("D1QueryError", (error) => Effect.die(error)),
        );

        if (!previousResult.ok) {
          yield* logD1Quota(previousResult.error);

          return;
        }

        const previous = previousResult.value;

        if (previous?.blockedUntil && previous.blockedUntil.getTime() > now.getTime()) {
          yield* logIngestionEvent({
            event: INGESTION_EVENTS.runSkipped,
            blockedUntil: previous.blockedUntil.toISOString(),
          });
          yield* recordHeartbeatSafe({
            at: now,
            status: "quota",
            blockedUntil: previous.blockedUntil,
          });

          return;
        }

        const accountsResult = yield* findSpotifyAccounts().pipe(
          Effect.map((rows) => ({ ok: true as const, rows })),
          Effect.catchTag("D1QuotaExceededError", (error) =>
            Effect.succeed({ ok: false as const, error }),
          ),
          Effect.catchTag("D1QueryError", (error) => Effect.die(error)),
        );

        if (!accountsResult.ok) {
          yield* logD1Quota(accountsResult.error);

          return;
        }

        const uniqueAccounts = deduplicateByUserId(accountsResult.rows);

        let fetched = 0;
        let skipped = 0;
        let totalPlays = 0;
        let failures = 0;

        for (const account of uniqueAccounts) {
          const outcome = yield* ingestAccount(account, now);

          if (outcome.kind === "spotify-quota") {
            yield* logIngestionFailure(INGESTION_EVENTS.quotaExhausted, outcome.error);

            const blockedUntil = computeQuotaBlock(outcome.error.retryAfterSeconds, now);

            yield* recordHeartbeatSafe({
              at: now,
              status: "quota",
              blockedUntil,
            });

            yield* logIngestionEvent({
              event: INGESTION_EVENTS.runComplete,
              status: "quota",
              accounts: uniqueAccounts.length,
              fetched,
              skipped,
              plays: totalPlays,
              failures,
              retryAfterSeconds: outcome.error.retryAfterSeconds,
            });

            return;
          }

          if (outcome.kind === "d1-quota") {
            yield* logD1Quota(outcome.error);

            return;
          }

          if (outcome.kind === "failed") {
            failures += 1;
            continue;
          }

          if (outcome.skipped) {
            skipped += 1;
          } else {
            fetched += 1;
            totalPlays += outcome.plays;
          }
        }

        const status = failures === 0 ? "ok" : "partial";

        yield* logIngestionEvent({
          event: INGESTION_EVENTS.runComplete,
          status,
          accounts: uniqueAccounts.length,
          fetched,
          skipped,
          plays: totalPlays,
          failures,
        });

        yield* recordHeartbeatSafe({
          at: now,
          status,
          blockedUntil: null,
        });
      });

      return Ingestion.of({
        run: (nowOverride) =>
          run(nowOverride).pipe(
            Effect.provideService(SqlClient.SqlClient, sql),
            Effect.provideService(D1Client.D1Client, d1),
          ),
      });
    }),
  );
}
