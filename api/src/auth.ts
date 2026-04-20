import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { db } from "./db";
import * as schema from "./db/schema";
import { env } from "./env";
import type { MiddlewareHandler } from "hono";
import type { Env } from ".";
import { findUserById } from "./db/queries/users";
import { HTTPException } from "hono/http-exception";
import { nanoid } from "nanoid";

export const auth = betterAuth({
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

export const authMiddleware: MiddlewareHandler<Env> = async (c, next) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers });

  if (!session) {
    throw new HTTPException(401);
  }

  c.set("user", session.user);
  c.set("session", session.session);

  c.set("getUserData", async () => {
    const user = await findUserById(session.user.id);

    // we shouldn't leave the request handlers handle this, we handle this ourselves here.
    // below we are throwing an HTTPException - that's an acceptable way for middlewares to
    // take control and stop the request cycle early. hopefully it's also acceptable for
    // such methods here
    if (!user) {
      if (!user) throw new HTTPException(401);
    }

    return user;
  });

  await next();
};
