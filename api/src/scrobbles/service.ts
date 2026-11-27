import { Context, Effect, Layer } from "effect";

import type { DbError } from "../db/errors.ts";
import type { Scrobble, User } from "../db/schema.ts";
import type { ProfilePrivateError, UserNotFoundError } from "../users/errors.ts";
import type { DatabaseRequirements } from "../db/service.ts";

import {
  countScrobblesByMonth,
  findRecordedPlaysBetween,
  persistPlays,
  type MonthlyScrobbleCount,
  type PersistPlaysOptions,
  type PlayRecord,
  type RecordedPlay,
} from "../db/queries/scrobbles.ts";
import {
  findPublicFeed,
  findRecentScrobblesByUserId,
  type FeedItem,
  type ProjectedScrobble,
  type RecentPlayFilters,
} from "../db/queries/recent-plays.ts";
import { D1Client } from "@effect/sql-d1";
import { SqlClient } from "effect/sql";
import { Users } from "../users/service.ts";
import { readScrobblePage, type CursorPageInput, type ScrobblePage } from "./page.ts";
import type { InvalidCursorError } from "./errors.ts";

export interface RecentScrobblesInput {
  readonly username: string;
  readonly offset: number;
  readonly limit: number;
  readonly before?: number;
}

export interface RecentPageInput extends CursorPageInput, RecentPlayFilters {
  readonly username?: string;
}

export interface ScrobbleMonthsInput {
  readonly username?: string;
  readonly timeZone: string;
}

export interface ScrobblesApi {
  readonly persistPlays: (
    plays: ReadonlyArray<PlayRecord>,
    options?: PersistPlaysOptions,
  ) => Effect.Effect<void, DbError>;
  readonly findRecordedPlaysBetween: (
    userId: User["id"],
    from: NonNullable<Scrobble["scrobbleDate"]>,
    to: NonNullable<Scrobble["scrobbleDate"]>,
  ) => Effect.Effect<RecordedPlay[], DbError>;
  readonly getRecent: (
    input: RecentScrobblesInput,
    viewerId?: User["id"],
  ) => Effect.Effect<ProjectedScrobble[], UserNotFoundError | ProfilePrivateError | DbError>;
  readonly getRecentPage: (
    input: RecentPageInput,
    viewerId?: User["id"],
  ) => Effect.Effect<
    ScrobblePage<ProjectedScrobble>,
    InvalidCursorError | UserNotFoundError | ProfilePrivateError | DbError
  >;
  readonly getMonths: (
    input: ScrobbleMonthsInput,
    viewerId?: User["id"],
  ) => Effect.Effect<MonthlyScrobbleCount[], UserNotFoundError | ProfilePrivateError | DbError>;
  readonly getPublicFeed: (
    input: CursorPageInput,
  ) => Effect.Effect<ScrobblePage<FeedItem>, InvalidCursorError | DbError>;
}

export class Scrobbles extends Context.Service<Scrobbles, ScrobblesApi>()(
  "@my.fm/api/scrobbles/Scrobbles",
) {
  static readonly layer: Layer.Layer<Scrobbles, never, Users | DatabaseRequirements> = Layer.effect(
    Scrobbles,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const d1 = yield* D1Client.D1Client;
      const users = yield* Users;

      const runDb = <A, E>(effect: Effect.Effect<A, E, DatabaseRequirements>) =>
        effect.pipe(
          Effect.provideService(SqlClient.SqlClient, sql),
          Effect.provideService(D1Client.D1Client, d1),
        );

      const persist = Effect.fn("Scrobbles.persistPlays")(function* (
        plays: ReadonlyArray<PlayRecord>,
        options?: PersistPlaysOptions,
      ) {
        return yield* runDb(persistPlays(plays, options));
      });

      const recordedBetween = Effect.fn("Scrobbles.findRecordedPlaysBetween")(function* (
        userId: User["id"],
        from: NonNullable<Scrobble["scrobbleDate"]>,
        to: NonNullable<Scrobble["scrobbleDate"]>,
      ) {
        return yield* runDb(findRecordedPlaysBetween(userId, from, to));
      });

      const getRecent = Effect.fn("Scrobbles.getRecent")(function* (
        input: RecentScrobblesInput,
        viewerId?: User["id"],
      ) {
        const profile = yield* users.viewProfileByUsername(input.username, viewerId);

        return yield* runDb(
          findRecentScrobblesByUserId(profile.id, input, { until: input.before }),
        );
      });

      const getRecentPage = Effect.fn("Scrobbles.getRecentPage")(
        (input: RecentPageInput, viewerId?: User["id"]) =>
          readScrobblePage(input, (window) =>
            Effect.gen(function* () {
              const profile = yield* users.viewListeningProfile(input.username, viewerId);

              return yield* runDb(findRecentScrobblesByUserId(profile.id, window, input));
            }),
          ),
      );

      const getMonths = Effect.fn("Scrobbles.getMonths")(function* (
        input: ScrobbleMonthsInput,
        viewerId?: User["id"],
      ) {
        const profile = yield* users.viewListeningProfile(input.username, viewerId);

        return yield* runDb(countScrobblesByMonth(profile.id, { timeZone: input.timeZone }));
      });

      const getPublicFeed = Effect.fn("Scrobbles.getPublicFeed")((input: CursorPageInput) =>
        readScrobblePage(input, (window) => runDb(findPublicFeed(window))),
      );

      return Scrobbles.of({
        persistPlays: persist,
        findRecordedPlaysBetween: recordedBetween,
        getRecent,
        getRecentPage,
        getMonths,
        getPublicFeed,
      });
    }),
  );
}
