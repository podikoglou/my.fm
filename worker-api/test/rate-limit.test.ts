import { env } from "cloudflare:workers";
import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { beforeEach, describe, expect, test } from "vitest";

import { createApp } from "../src/app.ts";
import { RATE_LIMITS, type RateLimitBindingName } from "../src/rate-limits.ts";
import worker from "../src/worker.ts";

const clientIp = "203.0.113.7";

beforeEach(async () => {
  const periodMs = RATE_LIMITS.PUBLIC_READ_RATE_LIMIT.period * 1000;
  const remainingMs = periodMs - (Date.now() % periodMs);

  // Miniflare's wall-clock windows must leave the full five-second test timeout.
  if (remainingMs < 5000) {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, remainingMs);
    });
  }
});

async function spendBudget(name: RateLimitBindingName, remaining = 0, key = "unknown") {
  for (let count = 0; count < RATE_LIMITS[name].limit - remaining; count += 1) {
    expect(await env[name].limit({ key })).toEqual({ success: true });
  }
}

/** The unauthenticated reads that the public policy covers. */
const publicReads = [
  "/api/feed",
  "/api/user/byUsername?username=alex",
  "/api/user/byId?id=V1StGXR8_Z5jdHi6B-myT",
  "/api/scrobble/getRecent?username=alex&offset=0",
];

describe("rate limits", () => {
  test("gives each policy its own namespace", () => {
    const ids = Object.values(RATE_LIMITS).map(({ namespaceId }) => namespaceId);

    // A shared namespace would merge two budgets into one.
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("serves requests below the budget", async () => {
    await spendBudget("PUBLIC_READ_RATE_LIMIT", 2, clientIp);
    const app = createApp();
    const headers = { "cf-connecting-ip": clientIp };

    const responses = [
      await app.request("/api/feed", { headers }, env),
      await app.request("/api/feed", { headers }, env),
    ];

    for (const response of responses) {
      expect(response.status).toBe(200);
    }
  });

  test("rejects the request above the budget", async () => {
    await spendBudget("PUBLIC_READ_RATE_LIMIT", 1, clientIp);
    const app = createApp();
    const headers = { "cf-connecting-ip": clientIp };

    expect((await app.request("/api/feed", { headers }, env)).status).toBe(200);

    const response = await app.request("/api/feed", { headers }, env);

    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({ error: "Too many requests" });
    // The window is the binding's period, which the binding does not refine.
    expect(response.headers.get("Retry-After")).toBe("60");
    // A cached rejection would outlive the window.
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  });

  test("keys the budget on the client address", async () => {
    await spendBudget("PUBLIC_READ_RATE_LIMIT", 1, clientIp);
    const app = createApp();

    const from = (ip: string) =>
      app.request("/api/feed", { headers: { "cf-connecting-ip": ip } }, env);

    expect((await from("203.0.113.7")).status).toBe(200);
    expect((await from("203.0.113.7")).status).toBe(429);
    expect((await from("198.51.100.4")).status).toBe(200);
  });

  test("shares one budget when the client address is missing", async () => {
    await spendBudget("PUBLIC_READ_RATE_LIMIT", 1);
    const app = createApp();

    expect((await app.request("/api/feed", undefined, env)).status).toBe(200);
    expect((await app.request("/api/feed", undefined, env)).status).toBe(429);
  });

  test("never limits the health routes", async () => {
    await spendBudget("AUTH_RATE_LIMIT");
    await spendBudget("PUBLIC_READ_RATE_LIMIT");

    const app = createApp();

    const health = await app.request("/health", undefined, env);
    const ingestion = await app.request("/health/ingestion", undefined, env);

    expect(health.status).toBe(200);

    // No run has been recorded, so the route answers with its own stale report.
    expect(ingestion.status).toBe(503);
    expect(await ingestion.json()).toMatchObject({ status: "stale" });
  });

  test("leaves the authenticated routes out of the public budget", async () => {
    await spendBudget("PUBLIC_READ_RATE_LIMIT");

    const response = await createApp().request("/api/user/me", undefined, env);

    expect(response.status).toBe(401);
  });
});

describe("auth rate limit", () => {
  test("limits registration and token writes before OAuth handling, by IP or the shared fallback", async () => {
    async function registerOrToken(path: string, ip?: string) {
      const ctx = createExecutionContext();
      const headers = new Headers({ "content-type": "application/json" });

      if (ip) headers.set("cf-connecting-ip", ip);

      const response = await worker.fetch(
        new Request("https://app.test" + path, {
          method: "POST",
          headers,
          body: JSON.stringify({
            client_name: "Rate limited client",
            redirect_uris: ["https://client.example/callback"],
            token_endpoint_auth_method: "none",
          }),
        }),
        env,
        ctx,
      );

      await waitOnExecutionContext(ctx);

      return response;
    }

    for (const ip of [undefined, clientIp]) {
      await spendBudget("AUTH_RATE_LIMIT", 1, ip);
      expect((await registerOrToken("/register", ip)).status).toBe(201);
      const keys = await env.OAUTH_KV.list();

      for (const path of ["/register", "/token"]) {
        const response = await registerOrToken(path, ip);

        expect(response.status).toBe(429);
        expect(await response.json()).toEqual({ error: "Too many requests" });
        expect(response.headers.get("Retry-After")).toBe("60");
        expect(response.headers.get("Cache-Control")).toBe("private, no-store");
      }

      expect(await env.OAUTH_KV.list()).toEqual(keys);
    }

    expect((await registerOrToken("/register", "198.51.100.4")).status).toBe(201);
  });

  test("limits the auth mount", async () => {
    await spendBudget("AUTH_RATE_LIMIT", 1);
    const app = createApp();

    expect((await app.request("/api/auth/get-session", undefined, env)).status).toBe(200);

    const response = await app.request("/api/auth/get-session", undefined, env);

    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({ error: "Too many requests" });
    expect(response.headers.get("Retry-After")).toBe("60");
  });
});

describe("public read rate limit", () => {
  test("limits every public read", async () => {
    for (const [index, path] of publicReads.entries()) {
      const headers = { "cf-connecting-ip": `203.0.113.${index + 1}` };
      await spendBudget("PUBLIC_READ_RATE_LIMIT", 1, headers["cf-connecting-ip"]);
      const app = createApp();

      const first = await app.request(path, { headers }, env);
      const second = await app.request(path, { headers }, env);

      expect([path, first.status]).not.toEqual([path, 429]);
      expect([path, second.status]).toEqual([path, 429]);
    }
  });
});
