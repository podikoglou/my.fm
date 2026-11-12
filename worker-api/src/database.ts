import * as Cloudflare from "@alchemy.run/cloudflare";
import { fileURLToPath } from "node:url";

/** D1 database with the drizzle-kit migrations. */
export const Database = Cloudflare.D1.Database("Database", {
  migrations: fileURLToPath(new URL("../drizzle/", import.meta.url)),
});
