import { sign } from "hono/jwt";
import { env } from "../env";
import type { User } from "../db/schema";
import { Temporal } from "@js-temporal/polyfill";

const JWT_DURATION = Temporal.Duration.from({ hours: 24 });

export type JwtPayload = {
  id: User["id"];
  exp: number;
};

export async function createJwt(userId: JwtPayload["id"]): Promise<string> {
  const exp = Temporal.Now.instant().add(JWT_DURATION);

  return sign({ userId, exp: exp.epochMilliseconds / 1000 }, env.SECRET);
}
