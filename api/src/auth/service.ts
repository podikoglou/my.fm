import { betterAuth } from "better-auth";
import { Context, Effect, Layer, Schema } from "effect";
import { nanoid } from "nanoid";
import { SqlClient } from "effect/sql";

import { effectSqlAdapter } from "./adapter.ts";

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
  "@my.fm/api/auth/AuthConfig",
) {
  static readonly layer = (config: AuthConfigValue) => Layer.succeed(AuthConfig, config);
}

export class AuthError extends Schema.TaggedError<AuthError>()("AuthError", {
  cause: Schema.Defect(),
}) {}

function createBetterAuth(
  database: Parameters<typeof effectSqlAdapter>[0],
  config: AuthConfigValue,
) {
  return betterAuth({
    secret: config.betterAuthSecret,
    database: effectSqlAdapter(database),
    socialProviders: {
      spotify: {
        clientId: config.spotifyClientId,
        clientSecret: config.spotifyClientSecret,
        scope: [...SPOTIFY_SCOPES],
      },
    },
    user: {
      modelName: "users",
      fields: {
        image: "avatarUrl",
        emailVerified: "email_verified",
        updatedAt: "updated_at",
      },
      additionalFields: {
        username: {
          type: "string",
          required: true,
          defaultValue: () => nanoid(),
        },
      },
    },
    session: {
      modelName: "sessions",
      fields: {
        expiresAt: "expires_at",
        createdAt: "created_at",
        updatedAt: "updated_at",
        ipAddress: "ip_address",
        userAgent: "user_agent",
        userId: "user_id",
      },
    },
    account: {
      modelName: "accounts",
      fields: {
        accountId: "account_id",
        providerId: "provider_id",
        userId: "user_id",
        accessToken: "access_token",
        refreshToken: "refresh_token",
        idToken: "id_token",
        accessTokenExpiresAt: "access_token_expires_at",
        refreshTokenExpiresAt: "refresh_token_expires_at",
        createdAt: "created_at",
        updatedAt: "updated_at",
      },
    },
    verification: {
      modelName: "verification",
      fields: {
        expiresAt: "expires_at",
        createdAt: "created_at",
        updatedAt: "updated_at",
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

export interface AccessTokenInput {
  readonly accountId: string;
  readonly userId: string;
}

export interface AuthServiceApi {
  readonly raw: BetterAuthInstance;
  readonly handler: (request: Request) => Effect.Effect<Response, AuthError>;
  readonly getSession: (headers: Headers) => Effect.Effect<AuthSession | null, AuthError>;
  readonly getAccessToken: (input: AccessTokenInput) => Effect.Effect<string | null, AuthError>;
}

export class AuthService extends Context.Service<AuthService, AuthServiceApi>()(
  "@my.fm/api/auth/AuthService",
) {
  static readonly layer = Layer.effect(
    AuthService,
    Effect.gen(function* () {
      const database = yield* SqlClient.SqlClient;
      const config = yield* AuthConfig;
      const auth = createBetterAuth(database, config);

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

      const getAccessToken = Effect.fn("AuthService.getAccessToken")(function* (
        input: AccessTokenInput,
      ) {
        const result = yield* Effect.tryPromise({
          try: () =>
            auth.api.getAccessToken({
              body: { accountId: input.accountId, userId: input.userId },
            }),
          catch: (cause) => new AuthError({ cause }),
        });

        return result?.accessToken || null;
      });

      return AuthService.of({
        raw: auth,
        handler,
        getSession,
        getAccessToken,
      });
    }),
  );
}
