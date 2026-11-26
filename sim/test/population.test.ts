import { describe, expect, test } from "bun:test";

import {
  countActiveUsers,
  generatePopulation,
  meanActiveShare,
  type Population,
  type UserPlays,
} from "../src/population.ts";

const MINUTE_MS = 60_000;

function user(plays: readonly number[]): UserPlays {
  return { playTimesMs: plays };
}

describe("generatePopulation", () => {
  test("replays the same population from the same seed", () => {
    const config = {
      users: 5,
      days: 2,
      sessionsPerDay: 3,
      sessionMinutes: 30,
      diurnal: "evening",
      seed: 42,
    } as const;

    expect(generatePopulation(config)).toEqual(generatePopulation(config));
  });

  test("emits each user's plays in ascending order", () => {
    const population = generatePopulation({
      users: 20,
      days: 3,
      sessionsPerDay: 4,
      sessionMinutes: 45,
      diurnal: "evening",
      seed: 11,
    });

    for (const { playTimesMs } of population.users) {
      const sorted = [...playTimesMs];

      sorted.sort((left, right) => left - right);
      expect(playTimesMs).toEqual(sorted);
    }
  });

  test("keeps plays inside the simulated horizon", () => {
    const days = 2;

    const population = generatePopulation({
      users: 10,
      days,
      sessionsPerDay: 3,
      sessionMinutes: 30,
      diurnal: "flat",
      seed: 5,
    });

    for (const { playTimesMs } of population.users) {
      for (const play of playTimesMs) {
        expect(play).toBeGreaterThanOrEqual(0);
        expect(play).toBeLessThan(days * 24 * 60 * MINUTE_MS + 120 * MINUTE_MS);
      }
    }
  });

  test("produces no plays without sessions", () => {
    const population = generatePopulation({
      users: 4,
      days: 2,
      sessionsPerDay: 0,
      sessionMinutes: 30,
      diurnal: "flat",
      seed: 1,
    });

    expect(population.totalPlays).toBe(0);
    expect(population.users.every(({ playTimesMs }) => playTimesMs.length === 0)).toBe(true);
  });
});

describe("countActiveUsers", () => {
  test("counts users with a play inside the activity window", () => {
    const population: Population = {
      users: [user([0, 3 * MINUTE_MS]), user([10 * MINUTE_MS]), user([40 * MINUTE_MS])],
      totalPlays: 4,
    };

    expect(countActiveUsers(population, 5 * MINUTE_MS, 15 * MINUTE_MS)).toBe(1);
    expect(countActiveUsers(population, 12 * MINUTE_MS, 15 * MINUTE_MS)).toBe(2);
    expect(countActiveUsers(population, 45 * MINUTE_MS, 15 * MINUTE_MS)).toBe(1);
  });

  test("drops a user once the window passed their last play", () => {
    const population: Population = { users: [user([0])], totalPlays: 1 };

    expect(countActiveUsers(population, 15 * MINUTE_MS, 15 * MINUTE_MS)).toBe(0);
  });
});

describe("meanActiveShare", () => {
  test("is 1 for users that never stop playing", () => {
    const plays = Array.from({ length: 24 * 20 }, (_, index) => index * 3 * MINUTE_MS);

    const population: Population = {
      users: [user(plays), user(plays)],
      totalPlays: plays.length * 2,
    };

    expect(meanActiveShare(population, 0, 24 * 60 * MINUTE_MS, 15 * MINUTE_MS)).toBe(1);
  });

  test("is 0 when nobody plays", () => {
    const population: Population = { users: [user([]), user([])], totalPlays: 0 };

    expect(meanActiveShare(population, 0, 24 * 60 * MINUTE_MS, 15 * MINUTE_MS)).toBe(0);
  });
});
