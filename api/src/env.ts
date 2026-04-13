import { z } from "zod";

const envSchema = z.object({
  SPOTIFY_CLIENT_ID: z.string(),
  SPOTIFY_CLIENT_SECRET: z.string(),
  SPOTIFY_REDIRECT_URI: z.string(),
  DATABASE_URL: z.string(),
  SECRET: z.string(),
  LOG_LEVEL: z.enum(["debug", "info", "warning", "error", "fatal", "trace"]).default("info"),
});

export const env = envSchema.parse(process.env);
