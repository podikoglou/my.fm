import z from "zod";

const envSchema = z.object({
  SPOTIFY_CLIENT_ID: z.string(),
});

export const ENV = envSchema.parse(process.env);
