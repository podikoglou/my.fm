import { drizzleAdapter } from "@better-auth/drizzle-adapter/relations-v2";
import { betterAuth } from "better-auth";
import { Context, Effect, Layer, Schema } from "effect";
import { nanoid } from "nanoid";

import * as schema from "../db/schema.ts";
import { Db, type DrizzleDatabase } from "../db/service.ts";

export const SPOTIFY_SCOPES = [
  "user-read-private",
  "user-read-email",
  "user-read-recently-played",
  "user-read-currently-playing",
] as const;

export interface AuthConfigValue {
  readonly betterAuthSecret: string;
  readonly spotifyClientId: string;
  readonly spotifyClientSecret: string;
}

export class AuthConfig extends Context.Service<AuthConfig, AuthConfigValue>()(
  "@my.fm/effect-api/auth/AuthConfig",
) {
  static readonly layer = (config: AuthConfigValue) => Layer.succeed(AuthConfig, config);
}

export class AuthError extends Schema.TaggedError<AuthError>()("AuthError", {
  cause: Schema.Defect(),
}) {}

function createBetterAuth(db: DrizzleDatabase, config: AuthConfigValue) {
  return betterAuth({
    secret: config.betterAuthSecret,
    database: drizzleAdapter(db, {
      provider: "sqlite",
      schema: {
        user: schema.users,
        account: schema.accounts,
        session: schema.sessions,
        verification: schema.verification,
      },
    }),
    socialProviders: {
      spotify: {
        clientId: config.spotifyClientId,
        clientSecret: config.spotifyClientSecret,
        scope: [...SPOTIFY_SCOPES],
      },
    },
    user: {
      fields: {
        image: "avatarUrl",
      },
      additionalFields: {
        username: {
          type: "string",
          required: true,
          defaultValue: () => nanoid(),
        },
      },
    },
    advanced: { database: { generateId: () => nanoid() } },
    databaseHooks: {
      user: {
        create: {
          async before(user) {
            return {
              data: {
                ...user,
                username: nanoid(),
              },
            };
          },
        },
      },
      account: {
        update: {
          async before(account, context) {
            if (account.providerId !== "spotify" || !context?.path.startsWith("/callback/")) {
              return;
            }

            return { data: { ...account, scope: SPOTIFY_SCOPES.join(",") } };
          },
        },
      },
    },
  });
}

export type BetterAuthInstance = ReturnType<typeof createBetterAuth>;

export type AuthSession = NonNullable<Awaited<ReturnType<BetterAuthInstance["api"]["getSession"]>>>;

export interface AuthServiceApi {
  readonly raw: BetterAuthInstance;
  readonly handler: (request: Request) => Effect.Effect<Response, AuthError>;
  readonly getSession: (headers: Headers) => Effect.Effect<AuthSession | null, AuthError>;
}

export class AuthService extends Context.Service<AuthService, AuthServiceApi>()(
  "@my.fm/effect-api/auth/AuthService",
) {
  static readonly layer = Layer.effect(
    AuthService,
    Effect.gen(function* () {
      const db = yield* Db;
      const config = yield* AuthConfig;
      const auth = createBetterAuth(db.drizzle, config);

      const handler = Effect.fn("AuthService.handler")(function* (request: Request) {
        return yield* Effect.tryPromise({
          try: () => auth.handler(request),
          catch: (cause) => new AuthError({ cause }),
        });
      });

      const getSession = Effect.fn("AuthService.getSession")(function* (headers: Headers) {
        return yield* Effect.tryPromise({
          try: () => auth.api.getSession({ headers }),
          catch: (cause) => new AuthError({ cause }),
        });
      });

      return AuthService.of({
        raw: auth,
        handler,
        getSession,
      });
    }),
  );
}
