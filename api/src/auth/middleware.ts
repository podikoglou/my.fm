import type { MiddlewareHandler } from "hono";
import { jwt } from "hono/jwt";
import { env } from "../env";
import type { Env } from "..";
import type { JwtPayload } from "./jwt";
import { findUserById } from "../db/queries/users";
import { HTTPException } from "hono/http-exception";
import { every } from "hono/combine";

const jwtMiddleware = jwt({
  secret: env.SECRET,
  alg: "HS256",
});

const lazyUserMiddleware: MiddlewareHandler<Env> = async (c, next) => {
  const { id }: JwtPayload = c.get("jwtPayload");

  c.set("getUser", async () => {
    const user = await findUserById(id);

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

export const authMiddleware = every(jwtMiddleware, lazyUserMiddleware);
