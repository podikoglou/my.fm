import type { MiddlewareHandler } from "hono";

import { HTTPException } from "hono/http-exception";

import type { AppEnv } from "./types.ts";

import { createAuth } from "./auth.ts";
import { createDatabase } from "./db/index.ts";
import { findUserById } from "./db/queries/users.ts";

/**
 * Attach the session when the request carries one. A request without a session
 * is valid and reaches the handler.
 */
export const sessionMiddleware: MiddlewareHandler<AppEnv> = async (c, next) => {
  const session = await createAuth(c.env).api.getSession({
    headers: c.req.raw.headers,
  });

  c.set("user", session?.user ?? null);
  c.set("session", session?.session ?? null);

  await next();
};

/**
 * Require the session that `sessionMiddleware` set, and expose the application
 * user. It must run after `sessionMiddleware`, so a request reads the session
 * once.
 */
export const requireSession: MiddlewareHandler<AppEnv> = async (c, next) => {
  const session = c.get("session");
  const viewer = c.get("user");

  if (!session || !viewer) {
    throw new HTTPException(401);
  }

  c.set("getUserData", async () => {
    const user = await findUserById(createDatabase(c.env.DB), viewer.id);

    // Stop the request cycle early if the session points at a deleted user.
    if (!user) {
      throw new HTTPException(401);
    }

    return user;
  });

  await next();
};
