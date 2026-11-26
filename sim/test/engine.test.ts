import { describe, expect, test } from "bun:test";

import { simulateScenario, type EngineConfig, type ScenarioMetrics } from "../src/engine.ts";
import { rateLimitLimiter, unlimitedLimiter } from "../src/limiter.ts";
import type { Population, UserPlays } from "../src/population.ts";

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;

function user(plays: readonly number[]): UserPlays {
  return { playTimesMs: plays };
}

function population(users: readonly UserPlays[]): Population {
  return {
    users,
    totalPlays: users.reduce((total, { playTimesMs }) => total + playTimesMs.length, 0),
  };
}

function run(
  pop: Population,
  totalMs: number,
  config: Partial<EngineConfig> = {},
): ScenarioMetrics {
  return simulateScenario(pop, totalMs, {
    requestMs: 200,
    warmupMs: 0,
    limiter: unlimitedLimiter(),
    ...config,
  });
}

describe("simulateScenario", () => {
  test("fetches inactive users on the ten-minute cadence", () => {
    const metrics = run(population([user([]), user([])]), 10 * HOUR_MS);

    // Never fetched at t=0, then every 10 minutes: 60 fetches per user over
    // the 600 ticks.
    expect(metrics.attempts).toBe(2 * 60);
    expect(metrics.allowed).toBe(2 * 60);
    expect(metrics.playsIngested).toBe(0);
  });

  test("holds active users on the three-minute cadence until the window closes", () => {
    const plays = Array.from({ length: 41 }, (_, index) => index * 3 * MINUTE_MS);

    const metrics = run(population([user(plays)]), 3 * HOUR_MS);

    // Ticks 0, 3, ... 132 (45 fetches) while the user stays active. The
    // activity window closes 15 minutes after the last play at tick 120, so
    // the next fetch waits for the ten-minute cadence: ticks 142, 152, 162,
    // 172.
    expect(metrics.attempts).toBe(49);
  });

  test("aborts the tick on the first rejection and blocks the run", () => {
    const metrics = run(population([user([]), user([]), user([])]), 25 * MINUTE_MS, {
      limiter: rateLimitLimiter(2),
    });

    // Tick 0: two allowed, the third denied. The 30-second block expires
    // before tick 1, so the unfetched account is picked up there and the
    // rest follow on the ten-minute cadence.
    expect(metrics.allowed).toBe(9);
    expect(metrics.deniedRateLimit).toBe(1);
    expect(metrics.throttledTicks).toBe(1);
    expect(metrics.attempts).toBe(10);
  });

  test("keeps warmup ticks out of the metrics but not out of the state", () => {
    const metrics = run(population([user([])]), 30 * MINUTE_MS, {
      warmupMs: 10 * MINUTE_MS,
    });

    // The warmup fetch at tick 0 drives the cadence; ticks 10 and 20 are due
    // again and measured.
    expect(metrics.attempts).toBe(2);
    expect(metrics.measuredDays).toBeCloseTo(20 / (24 * 60), 10);
  });

  test("does not count warmup rejections in the verdict metrics", () => {
    const metrics = run(population([user([]), user([])]), 10 * MINUTE_MS, {
      warmupMs: MINUTE_MS,
      limiter: rateLimitLimiter(1),
    });

    expect(metrics.attempts).toBe(1);
    expect(metrics.deniedRateLimit).toBe(0);
    expect(metrics.allowed).toBe(1);
  });

  test("returns at most one page per fetch and resumes from the cursor", () => {
    const plays = Array.from({ length: 60 }, () => MINUTE_MS);

    const metrics = run(population([user(plays)]), HOUR_MS);

    // The first fetch at t=0 sees nothing; tick 10 returns the first 50
    // plays, tick 13 the remaining 10 once the active cadence takes over.
    expect(metrics.playsIngested).toBe(60);
    expect(metrics.lag.samples).toBe(60);
    expect(metrics.lag.p50Ms).toBe(9 * MINUTE_MS);
    expect(metrics.lag.maxMs).toBe(12 * MINUTE_MS);
  });

  test("measures the peak 30-second window across tick boundaries", () => {
    const users = Array.from({ length: 40 }, (_, index) => user([index]));

    const metrics = run(population(users), MINUTE_MS, {
      requestMs: 1000,
    });

    // 40 requests spaced a second apart: at most 30 land in any 30-second
    // window (the burst starts at t=0, so windows cover requests 0..29).
    expect(metrics.peak30s).toBe(30);
    expect(metrics.maxTickAttempts).toBe(40);
  });
});
