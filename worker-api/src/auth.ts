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
 * read from the environment are passed explicitly from bindings.
 *
 * The app is served from the same origin as the auth routes, so Better Auth
 * derives its base URL and trusted origin from the incoming request. This
 * means that no deploy-time origin or redirect values are needed.
 */
export function createAuth(env: WorkerEnv) {
  const db = createDatabase(env.DB);

  return betterAuth({
    secret: env.BETTER_AUTH_SECRET,
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
          // Better Auth 1.7 validates required fields from the provider profile
          // before the create hook runs. The Spotify profile has no username,
          // so a default value keeps the first sign-in working.
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
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;
