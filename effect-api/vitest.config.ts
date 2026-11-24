import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

import { RATE_LIMITS } from "./src/rate-limits.ts";

// Until PR 7 moves drizzle/ into effect-api/, reuse the checked-in migrations
// from worker-api/ so both packages run against the exact same schema.
const migrations = await readD1Migrations({
  projectPath: import.meta.dirname + "/../worker-api",
  migrationsDir: "drizzle",
  migrationsPattern: "drizzle/*/migration.sql",
});

export default defineConfig({
  plugins: [
    cloudflareTest({
      main: "./src/worker.ts",
      miniflare: {
        compatibilityDate: "2026-11-02",
        compatibilityFlags: ["global_fetch_strictly_public"],
        kvNamespaces: ["OAUTH_KV"],
        d1Databases: ["DB"],
        r2Buckets: ["IMPORTS_BUCKET"],
        ratelimits: Object.fromEntries(
          Object.entries(RATE_LIMITS).map(([name, { namespaceId, limit, period }]) => [
            name,
            { namespace_id: String(namespaceId), simple: { limit, period } },
          ]),
        ),
        bindings: {
          TEST_MIGRATIONS: migrations.sort((a, b) => a.name.localeCompare(b.name)),
          BETTER_AUTH_SECRET: "test-secret-test-secret-test-secret",
          SPOTIFY_CLIENT_ID: "test-client-id",
          SPOTIFY_CLIENT_SECRET: "test-client-secret",
        },
      },
    }),
  ],
  test: { include: ["test/**/*.test.ts"], setupFiles: ["./test/setup.ts"] },
});
