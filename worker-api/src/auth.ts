import { drizzleAdapter } from "@better-auth/drizzle-adapter/relations-v2";
import { betterAuth } from "better-auth";
import { nanoid } from "nanoid";

import type { WorkerEnv } from "./alchemy.ts";

import { createDatabase } from "./db/index.ts";
import * as schema from "./db/schema.ts";

export const SPOTIFY_SCOPES = [
  "user-read-private",
  "user-read-email",
  "user-read-recently-played",
  "user-read-currently-playing",
] as const;

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
          // Spotify profiles have no username, so provide one before validation.
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
          // Better Auth does not update the stored scope on sign-in. Spotify
          // grants every requested scope or none, so a completed sign-in has
          // granted them all. Token refreshes run elsewhere and keep the scope.
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

export type Auth = ReturnType<typeof createAuth>;
