import { drizzleAdapter } from "@better-auth/drizzle-adapter/relations-v2";
import { betterAuth } from "better-auth";
import { nanoid } from "nanoid";

import type { WorkerEnv } from "./alchemy.ts";

import { createDatabase } from "./db/index.ts";
import * as schema from "./db/schema.ts";

/**
 * Create the Better Auth instance for the current Worker environment.
 *
 * A Worker has no `process.env`, so the values Better Auth would otherwise
 * read from the environment are passed explicitly from bindings. The
 * configuration itself mirrors the Bun API.
 *
 * `origin` is the origin of the incoming request. The app is served from the
 * same origin as the auth routes, so Better Auth builds its URLs and the
 * Spotify callback from that origin instead of deploy-time configuration.
 * Ingestion calls this function without a request; it only uses the provider
 * token API, which does not need an origin.
 */
export function createAuth(env: WorkerEnv, origin?: string) {
  const db = createDatabase(env.DB);

  return betterAuth({
    secret: env.BETTER_AUTH_SECRET,
    baseURL: origin,
    database: drizzleAdapter(db, {
      provider: "sqlite",
      schema: {
        user: schema.users,
        account: schema.accounts,
        session: schema.sessions,
        verification: schema.verification,
      },
    }),
    trustedOrigins: origin ? [origin] : undefined,
    socialProviders: {
      spotify: {
        clientId: env.SPOTIFY_CLIENT_ID,
        clientSecret: env.SPOTIFY_CLIENT_SECRET,
        scope: ["user-read-private", "user-read-email", "user-read-recently-played"],
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
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;
