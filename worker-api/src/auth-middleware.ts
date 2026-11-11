import type { MiddlewareHandler } from "hono";

import { HTTPException } from "hono/http-exception";

import type { AppEnv } from "./types.ts";

import { createAuth } from "./auth.ts";
import { createDatabase } from "./db/index.ts";
import { findUserById } from "./db/queries/users.ts";

/**
 * Require a Better Auth session and expose the application user on the
 * request context. Mirrors the Bun API middleware.
 */
export const authMiddleware: MiddlewareHandler<AppEnv> = async (c, next) => {
  const session = await createAuth(c.env).api.getSession({
    headers: c.req.raw.headers,
  });

  if (!session) {
    throw new HTTPException(401);
  }

  c.set("user", session.user);
  c.set("session", session.session);

  c.set("getUserData", async () => {
    const user = await findUserById(createDatabase(c.env.DB), session.user.id);

    // Stop the request cycle early if the session points at a deleted user.
    if (!user) {
      throw new HTTPException(401);
    }

    return user;
  });

  await next();
};
