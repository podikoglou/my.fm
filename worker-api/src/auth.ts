import { drizzleAdapter } from "@better-auth/drizzle-adapter/relations-v2";
import { betterAuth } from "better-auth";
import { nanoid } from "nanoid";

import type { WorkerEnv } from "./alchemy.ts";

import { createDatabase } from "./db/index.ts";
import * as schema from "./db/schema.ts";

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
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;
