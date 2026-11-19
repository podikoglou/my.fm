import { applyD1Migrations, reset } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { http } from "msw";
import { afterAll, afterEach, beforeAll, beforeEach, vi } from "vitest";

import { network } from "./network.ts";

beforeAll(() => network.enable());

beforeEach(async () => {
  await reset();
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
  network.use(
    http.all("*", ({ request }) => {
      throw new Error(`Unexpected outbound request: ${request.method} ${request.url}`);
    }),
  );
});

afterEach(() => {
  network.resetHandlers();
  vi.restoreAllMocks();
});

afterAll(() => network.disable());
