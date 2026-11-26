import { makeRng, weightedIndex, type Rng } from "./rng.ts";

/** When users listen across the day; drives the share of users on the active cadence. */
export type DiurnalPattern = "flat" | "evening";

export interface PopulationConfig {
  readonly users: number;
  readonly days: number;
  /** Mean listening sessions per user per day. */
  readonly sessionsPerDay: number;
  /** Mean session length in minutes. */
  readonly sessionMinutes: number;
  readonly diurnal: DiurnalPattern;
  readonly seed: number;
}

export interface UserPlays {
  /** Absolute play timestamps in ms since the simulation start, ascending. */
  readonly playTimesMs: readonly number[];
}

export interface Population {
  readonly users: ReadonlyArray<UserPlays>;
  readonly totalPlays: number;
}

/** Hour weights for each diurnal pattern: night, morning, day, evening. */
const HOUR_WEIGHTS: Record<DiurnalPattern, readonly [number, number, number, number]> = {
  flat: [1, 1, 1, 1],
  evening: [0.15, 1, 0.8, 3],
};

function cumulativeMinuteWeights(diurnal: DiurnalPattern): number[] {
  const [night, morning, day, evening] = HOUR_WEIGHTS[diurnal];
  const weights: number[] = [];

  for (let minute = 0; minute < 24 * 60; minute++) {
    const hour = Math.floor(minute / 60);

    const weight = hour < 7 ? night : hour < 10 ? morning : hour < 17 ? day : evening;

    weights.push((weights[minute - 1] ?? 0) + weight);
  }

  return weights;
}

function generateUserPlays(
  rng: Rng,
  config: PopulationConfig,
  weights: readonly number[],
): number[] {
  const plays: number[] = [];

  for (let day = 0; day < config.days; day++) {
    for (let session = 0; session < config.sessionsPerDay; session++) {
      const startMinute = day * 24 * 60 + weightedIndex(rng, weights);

      const lengthMinutes = Math.max(
        1,
        Math.round(config.sessionMinutes * rng.floatBetween(0.5, 1.5)),
      );

      const endMinute = startMinute + lengthMinutes;

      for (let minute = startMinute; minute < endMinute; minute += rng.floatBetween(3, 5)) {
        plays.push(Math.round(minute * 60_000));
      }
    }
  }

  plays.sort((left, right) => left - right);

  return plays;
}

export function generatePopulation(config: PopulationConfig): Population {
  const rng = makeRng(config.seed);
  const weights = cumulativeMinuteWeights(config.diurnal);
  const users: UserPlays[] = [];

  for (let index = 0; index < config.users; index++) {
    users.push({ playTimesMs: generateUserPlays(rng, config, weights) });
  }

  return {
    users,
    totalPlays: users.reduce((total, user) => total + user.playTimesMs.length, 0),
  };
}

/** Number of plays in `(afterMs, atMs]`. */
function playsUntil(user: UserPlays, atMs: number): number {
  let low = 0;
  let high = user.playTimesMs.length;

  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    const play = user.playTimesMs[mid];

    if (play === undefined || play <= atMs) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }

  return low;
}

/**
 * Users with a play in the activity window ending at `atMs`, which is the
 * population the ingestion schedule fetches on the active cadence.
 */
export function countActiveUsers(
  population: Population,
  atMs: number,
  activityWindowMs: number,
): number {
  let active = 0;

  for (const user of population.users) {
    if (playsUntil(user, atMs) > playsUntil(user, atMs - activityWindowMs)) {
      active += 1;
    }
  }

  return active;
}

/**
 * Mean share of users on the active cadence over the measured window, sampled
 * twice an hour.
 */
export function meanActiveShare(
  population: Population,
  fromMs: number,
  toMs: number,
  activityWindowMs: number,
): number {
  const sampleStepMs = 30 * 60_000;
  let samples = 0;
  let total = 0;

  for (let at = fromMs; at < toMs; at += sampleStepMs) {
    total += countActiveUsers(population, at, activityWindowMs);
    samples += 1;
  }

  return samples === 0 ? 0 : total / samples / population.users.length;
}
