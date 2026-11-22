import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "sqlite",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  // drizzle-kit only generates SQL in this package; Alchemy applies the
  // generated migrations to D1. The URL is never opened by `generate`.
  dbCredentials: { url: "file:./.drizzle-kit/dev.db" },
});
