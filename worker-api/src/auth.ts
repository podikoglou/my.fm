import { drizzleAdapter } from "@better-auth/drizzle-adapter/relations-v2";
import { betterAuth } from "better-auth";
import { nanoid } from "nanoid";

import type { WorkerEnv } from "../alchemy.run.ts";

import { createDatabase } from "./db/index.ts";
import * as schema from "./db/schema.ts";

/**
 * Create the Better Auth instance for the current Worker environment.
 *
 * A Worker has no `process.env`, so the values Better Auth would otherwise
 * read from the environment are passed explicitly from bindings. The
 * configuration itself mirrors the Bun API.
 */
export function createAuth(env: WorkerEnv) {
  const db = createDatabase(env.DB);

  return betterAuth({
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    database: drizzleAdapter(db, {
      provider: "sqlite",
      schema: {
        user: schema.users,
        account: schema.accounts,
        session: schema.sessions,
        verification: schema.verification,
      },
    }),
    trustedOrigins: [env.FRONTEND_URL],
    socialProviders: {
      spotify: {
        clientId: env.SPOTIFY_CLIENT_ID,
        clientSecret: env.SPOTIFY_CLIENT_SECRET,
        redirectURI: env.SPOTIFY_REDIRECT_URI,
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
