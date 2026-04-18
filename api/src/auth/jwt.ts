import { sign } from "hono/jwt";
import { add } from "date-fns";
import { env } from "../env";
import type { User } from "../db/schema";

export type JwtPayload = {
  userId: User["id"];
  exp: number;
};

export async function createJwt(userId: JwtPayload["userId"]): Promise<string> {
  const exp = add(new Date(), { hours: 24 });

  return sign({ userId, exp: exp.getTime() / 1000 }, env.SECRET);
}
