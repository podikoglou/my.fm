import { describe, expect, test } from "bun:test";

import {
  composeLimiters,
  quotaLimiter,
  rateLimitLimiter,
  TimeWindow,
  unlimitedLimiter,
} from "../src/limiter.ts";

describe("rateLimitLimiter", () => {
  test("allows up to the threshold inside the rolling window", () => {
    const limiter = rateLimitLimiter(2);

    expect(limiter.attempt(0)).toEqual({ allowed: true });
    expect(limiter.attempt(1000)).toEqual({ allowed: true });
    expect(limiter.attempt(2000)).toEqual({
      allowed: false,
      reason: "rate-limit",
      retryAfterSeconds: 28,
    });
  });

  test("recovers once the oldest request leaves the window", () => {
    const limiter = rateLimitLimiter(2);

    limiter.attempt(0);
    limiter.attempt(1000);

    expect(limiter.attempt(31_000).allowed).toBe(true);
  });

  test("holds the denial until the oldest request expires", () => {
    const limiter = rateLimitLimiter(2);

    limiter.attempt(0);
    limiter.attempt(200);

    expect(limiter.attempt(29_999).allowed).toBe(false);
    expect(limiter.attempt(30_000).allowed).toBe(true);
  });
});

describe("quotaLimiter", () => {
  test("denies with a full-day drain once the bucket is exhausted", () => {
    const limiter = quotaLimiter(2);

    limiter.attempt(0);
    limiter.attempt(1);

    expect(limiter.attempt(2)).toEqual({
      allowed: false,
      reason: "quota",
      retryAfterSeconds: 24 * 60 * 60,
    });
  });
});

describe("composeLimiters", () => {
  test("an allowed request is recorded against every limiter", () => {
    const rate = rateLimitLimiter(1);
    const quota = quotaLimiter(1);

    const combined = composeLimiters([rate, quota]);

    expect(combined.attempt(0)).toEqual({ allowed: true });

    // The rolling limiter denies the next request inside its window.
    expect(combined.attempt(1).allowed).toBe(false);

    // The quota bucket also holds the first attempt for a full day.
    expect(quota.attempt(2).allowed).toBe(false);
  });

  test("the first denial wins and later limiters never see the attempt", () => {
    const rate = rateLimitLimiter(1);
    const quota = quotaLimiter(10);

    const combined = composeLimiters([rate, quota]);

    combined.attempt(0);

    const decision = combined.attempt(1);

    expect(decision.allowed).toBe(false);

    if (!decision.allowed) {
      expect(decision.reason).toBe("rate-limit");
    }

    // The rate-denied attempt was not recorded in the quota bucket.
    expect(quota.attempt(60_000)).toEqual({ allowed: true });
  });
});

describe("unlimitedLimiter", () => {
  test("never denies", () => {
    const limiter = unlimitedLimiter();

    for (let index = 0; index < 1000; index += 1) {
      expect(limiter.attempt(index)).toEqual({ allowed: true });
    }
  });
});

describe("TimeWindow", () => {
  test("drops timestamps that reached the cutoff", () => {
    const window = new TimeWindow(30_000);

    window.push(0, 30_000, 60_000);
    window.prune(30_000);

    expect(window.size).toBe(1);
    expect(window.oldest).toBe(60_000);
  });

  test("keeps timestamps after the cutoff", () => {
    const window = new TimeWindow(30_000);

    window.push(5000);
    window.prune(4999);

    expect(window.size).toBe(1);
  });
});
