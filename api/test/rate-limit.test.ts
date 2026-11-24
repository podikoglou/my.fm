import { env } from "cloudflare:workers";
import { Layer } from "effect";
import { HttpRouter, HttpServer, HttpServerResponse } from "effect/http";
import { beforeEach, describe, expect, test } from "vitest";

import { DefaultCacheControlMiddleware, rateLimitMiddleware } from "../src/http/middleware.ts";
import { RATE_LIMITS, type RateLimitBindingName } from "../src/rate-limits.ts";
import worker, { makeWorkerInfraLayer } from "../src/worker.ts";

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

async function requestLimitedRoute(
  policy: RateLimitBindingName,
  headers?: HeadersInit,
): Promise<Response> {
  const router = HttpRouter.add(
    "GET",
    "/limited",
    HttpServerResponse.jsonUnsafe({ ok: true }),
  ).pipe(
    Layer.provide(rateLimitMiddleware(policy)),
    Layer.merge(DefaultCacheControlMiddleware),
    Layer.provide(makeWorkerInfraLayer(env)),
    Layer.provide(HttpServer.layerServices),
  );

  const { handler, dispose } = HttpRouter.toWebHandler(router, { disableLogger: true });

  try {
    return await handler(new Request("https://app.test/limited", { headers }));
  } finally {
    await dispose();
  }
}

describe("rate limits", () => {
  test("gives each policy its own namespace", () => {
    const ids = Object.values(RATE_LIMITS).map(({ namespaceId }) => namespaceId);

    // A shared namespace would merge two budgets into one.
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("serves requests below the budget", async () => {
    await spendBudget("PUBLIC_READ_RATE_LIMIT", 2, clientIp);
    const headers = { "cf-connecting-ip": clientIp };

    const responses = [
      await requestLimitedRoute("PUBLIC_READ_RATE_LIMIT", headers),
      await requestLimitedRoute("PUBLIC_READ_RATE_LIMIT", headers),
    ];

    for (const response of responses) {
      expect(response.status).toBe(200);
    }
  });

  test("rejects the request above the budget", async () => {
    await spendBudget("PUBLIC_READ_RATE_LIMIT", 1, clientIp);
    const headers = { "cf-connecting-ip": clientIp };

    expect((await requestLimitedRoute("PUBLIC_READ_RATE_LIMIT", headers)).status).toBe(200);

    const response = await requestLimitedRoute("PUBLIC_READ_RATE_LIMIT", headers);

    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({ error: "Too many requests" });
    // The window is the binding's period, which the binding does not refine.
    expect(response.headers.get("Retry-After")).toBe("60");
    // A cached rejection would outlive the window.
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  });

  test("keys the budget on the client address", async () => {
    await spendBudget("PUBLIC_READ_RATE_LIMIT", 1, clientIp);

    const from = (ip: string) =>
      requestLimitedRoute("PUBLIC_READ_RATE_LIMIT", { "cf-connecting-ip": ip });

    expect((await from("203.0.113.7")).status).toBe(200);
    expect((await from("203.0.113.7")).status).toBe(429);
    expect((await from("198.51.100.4")).status).toBe(200);
  });

  test("shares one budget when the client address is missing", async () => {
    await spendBudget("PUBLIC_READ_RATE_LIMIT", 1);

    expect((await requestLimitedRoute("PUBLIC_READ_RATE_LIMIT")).status).toBe(200);
    expect((await requestLimitedRoute("PUBLIC_READ_RATE_LIMIT")).status).toBe(429);
  });

  test("keeps auth and public read policies isolated", async () => {
    await spendBudget("PUBLIC_READ_RATE_LIMIT", 0, clientIp);

    const authResponse = await requestLimitedRoute("AUTH_RATE_LIMIT", {
      "cf-connecting-ip": clientIp,
    });

    expect(authResponse.status).toBe(200);
  });

  test("never limits the health routes", async () => {
    await spendBudget("AUTH_RATE_LIMIT");
    await spendBudget("PUBLIC_READ_RATE_LIMIT");

    const health = await worker.fetch(new Request("https://app.test/health"), env);
    const ingestion = await worker.fetch(new Request("https://app.test/health/ingestion"), env);

    expect(health.status).toBe(200);

    // No run has been recorded, so the route answers with its own stale report.
    expect(ingestion.status).toBe(503);
    expect(await ingestion.json()).toMatchObject({ status: "stale" });
  });
});
