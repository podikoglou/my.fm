import { Context, Effect, Layer } from "effect";

import type { DbError } from "../db/errors.ts";
import type { Scrobble, User } from "../db/schema.ts";
import type { ProfilePrivateError, UserNotFoundError } from "../users/errors.ts";
import type { DatabaseRequirements } from "../db/service.ts";

import {
  countScrobblesByMonth,
  findPublicFeed,
  findRecentScrobblesByUserId,
  findRecordedPlaysBetween,
  persistPlays,
  type FeedItem,
  type FeedCursor,
  type MonthlyScrobbleCount,
  type PersistPlaysOptions,
  type PlayRecord,
  type ProjectedScrobble,
  type RecordedPlay,
} from "../db/queries/scrobbles.ts";
import { D1Client } from "@effect/sql-d1";
import { SqlClient } from "effect/sql";
import { Users } from "../users/service.ts";
import { decodeFeedCursor, encodeFeedCursor } from "./cursor.ts";
import type { InvalidCursorError } from "./errors.ts";

export interface RecentScrobblesInput {
  /** null starts the dated keyset page; undefined preserves offset pagination. */
  readonly pageAfter?: FeedCursor | null;
  readonly username: string;
  readonly offset: number;
  readonly limit: number;
  readonly before?: number;
}

export interface ScrobbleMonthsInput {
  readonly username: string;
  readonly timeZone: string;
}

export interface PublicFeedInput {
  readonly cursor?: string;
  readonly limit: number;
}

export interface PublicFeedPage {
  readonly items: FeedItem[];
  readonly nextCursor: string | null;
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
  readonly getMonths: (
    input: ScrobbleMonthsInput,
    viewerId?: User["id"],
  ) => Effect.Effect<MonthlyScrobbleCount[], UserNotFoundError | ProfilePrivateError | DbError>;
  readonly getPublicFeed: (
    input: PublicFeedInput,
  ) => Effect.Effect<PublicFeedPage, InvalidCursorError | DbError>;
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
          findRecentScrobblesByUserId(
            profile.id,
            {
              offset: input.offset,
              limit: input.limit,
              before: input.before === undefined ? undefined : new Date(input.before * 1000),
            },
            input.pageAfter,
          ),
        );
      });

      const getMonths = Effect.fn("Scrobbles.getMonths")(function* (
        input: ScrobbleMonthsInput,
        viewerId?: User["id"],
      ) {
        const profile = yield* users.viewProfileByUsername(input.username, viewerId);

        return yield* runDb(countScrobblesByMonth(profile.id, { timeZone: input.timeZone }));
      });

      const getPublicFeed = Effect.fn("Scrobbles.getPublicFeed")(function* (
        input: PublicFeedInput,
      ) {
        const cursor =
          input.cursor === undefined ? undefined : yield* decodeFeedCursor(input.cursor);

        const items = yield* runDb(findPublicFeed({ cursor, limit: input.limit + 1 }));

        const page = items.slice(0, input.limit);
        const last = page.at(-1);
        const nextCursor = items.length > input.limit && last ? encodeFeedCursor(last) : null;

        return { items: page, nextCursor };
      });

      return Scrobbles.of({
        persistPlays: persist,
        findRecordedPlaysBetween: recordedBetween,
        getRecent,
        getMonths,
        getPublicFeed,
      });
    }),
  );
}
