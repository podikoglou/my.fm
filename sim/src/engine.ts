import {
  ACTIVE_WINDOW_MS,
  computeQuotaBlock,
  shouldFetchUser,
} from "../../api/src/ingestion/schedule.ts";

import { TimeWindow, type Limiter, type LimiterDecision } from "./limiter.ts";
import { meanActiveShare, type Population } from "./population.ts";

/** The ingestion cron triggers every minute. */
export const TICK_MS = 60_000;

/** Spotify caps a recently-played page at 50 items. */
export const PAGE_LIMIT = 50;

const DAY_MS = 24 * 60 * 60_000;

export interface EngineConfig {
  /** One sequential recently-played request, including latency. */
  readonly requestMs: number;
  /** Ticks before this offset drive state but land outside the metrics. */
  readonly warmupMs: number;
  readonly limiter: Limiter;
}

export interface LagStats {
  readonly samples: number;
  readonly p50Ms: number;
  readonly p95Ms: number;
  readonly maxMs: number;
}

export interface ScenarioMetrics {
  readonly measuredDays: number;
  /** Every request that reached Spotify, allowed or denied. */
  readonly attempts: number;
  readonly allowed: number;
  readonly deniedRateLimit: number;
  readonly deniedQuota: number;
  /** Ticks that a rejection aborted, plus ticks skipped while blocked. */
  readonly throttledTicks: number;
  readonly peak30s: number;
  readonly peak24h: number;
  readonly maxTickAttempts: number;
  readonly requestsPerDay: number;
  readonly playsIngested: number;
  readonly lag: LagStats;
  readonly meanActiveShare: number;
}

/**
 * Per-user scheduling state, mirroring the columns the ingestion service
 * reads, plus the index of the first play no fetch has returned yet.
 */
interface UserState {
  lastFetchedAt: Date | null;
  lastActiveAt: Date | null;
  lastRecentTracksFetchTime: Date | null;
  nextPlayIndex: number;
}

/** One recently-played page: the plays a fetch returned, and what it implies. */
interface Page {
  readonly start: number;
  readonly count: number;
  readonly newestPlayMs: number | null;
  readonly hasRecentPlay: boolean;
}

/**
 * Replay the cron loop over a population: every minute, offer each due user
 * one recently-played request to the limiter, and mirror the ingestion
 * service's decisions — page limit, cursor advance, activity window, abort
 * the whole tick on the first rejection, then block the run.
 */
export function simulateScenario(
  population: Population,
  totalMs: number,
  config: EngineConfig,
): ScenarioMetrics {
  const states: UserState[] = population.users.map(() => ({
    lastFetchedAt: null,
    lastActiveAt: null,
    lastRecentTracksFetchTime: null,
    nextPlayIndex: 0,
  }));

  let blockedUntil: Date | null = null;
  let attempts = 0;
  let allowed = 0;
  let deniedRateLimit = 0;
  let deniedQuota = 0;
  let throttledTicks = 0;
  let maxTickAttempts = 0;
  let playsIngested = 0;
  let peak30s = 0;
  let peak24h = 0;

  const peak30sWindow = new TimeWindow(30_000);
  const peak24hWindow = new TimeWindow(DAY_MS);
  const lagSamples: number[] = [];

  for (let now = 0; now < totalMs; now += TICK_MS) {
    const nowDate = new Date(now);
    const measured = now >= config.warmupMs;

    if (blockedUntil !== null && blockedUntil.getTime() > now) {
      if (measured) {
        throttledTicks += 1;
      }

      continue;
    }

    let tickAttempts = 0;
    let denied = false;

    for (let index = 0; index < states.length; index += 1) {
      const state = states[index];

      if (state === undefined || !shouldFetchUser(state, nowDate)) {
        continue;
      }

      const atMs = now + tickAttempts * config.requestMs;

      tickAttempts += 1;

      // Spotify's edge sees every attempt, so the traffic windows count
      // denials too.
      peak30sWindow.push(atMs);
      peak24hWindow.push(atMs);
      peak30sWindow.prune(atMs - 30_000);
      peak24hWindow.prune(atMs - DAY_MS);

      const decision = config.limiter.attempt(atMs);

      if (!decision.allowed) {
        blockedUntil = computeQuotaBlock(decision.retryAfterSeconds, nowDate);
        denied = true;

        if (measured) {
          countDenial(decision);
        }

        break;
      }

      const plays = population.users[index]?.playTimesMs ?? [];
      const page = nextPage(state, plays, now);

      applyPage(state, page, now);

      if (measured) {
        allowed += 1;
        playsIngested += page.count;
        collectLag(page, plays, now, lagSamples);
      }
    }

    if (measured) {
      attempts += tickAttempts;
      maxTickAttempts = Math.max(maxTickAttempts, tickAttempts);

      if (denied) {
        throttledTicks += 1;
      }

      peak30s = Math.max(peak30s, peak30sWindow.size);
      peak24h = Math.max(peak24h, peak24hWindow.size);
    }
  }

  const measuredMs = totalMs - config.warmupMs;

  return {
    measuredDays: measuredMs / DAY_MS,
    attempts,
    allowed,
    deniedRateLimit,
    deniedQuota,
    throttledTicks,
    peak30s,
    peak24h,
    maxTickAttempts,
    requestsPerDay: (allowed / measuredMs) * DAY_MS,
    playsIngested,
    lag: lagStats(lagSamples),
    meanActiveShare: meanActiveShare(population, config.warmupMs, totalMs, ACTIVE_WINDOW_MS),
  };

  function countDenial(decision: LimiterDecision): void {
    if (decision.allowed) {
      return;
    }

    if (decision.reason === "rate-limit") {
      deniedRateLimit += 1;
    } else {
      deniedQuota += 1;
    }
  }
}

/**
 * The plays a fetch at `nowMs` returns: up to the page limit, in play order,
 * mirroring `getRecentlyPlayedTracks` with an `after` cursor.
 */
function nextPage(state: UserState, plays: readonly number[], nowMs: number): Page {
  let count = 0;
  let newestPlayMs: number | null = null;
  let hasRecentPlay = false;

  while (count < PAGE_LIMIT) {
    const playMs = plays[state.nextPlayIndex + count];

    if (playMs === undefined || playMs > nowMs) {
      break;
    }

    count += 1;
    newestPlayMs = playMs;
    hasRecentPlay = hasRecentPlay || nowMs - playMs < ACTIVE_WINDOW_MS;
  }

  return { start: state.nextPlayIndex, count, newestPlayMs, hasRecentPlay };
}

/**
 * Write a returned page back into the scheduling state, mirroring
 * `updateUserFetchState`: the cursor is the newest returned play, an empty
 * page keeps the old cursor, and a recent play marks the user active.
 */
function applyPage(state: UserState, page: Page, nowMs: number): void {
  state.nextPlayIndex = page.start + page.count;

  const cursorMs =
    page.newestPlayMs !== null
      ? page.newestPlayMs
      : (state.lastRecentTracksFetchTime?.getTime() ?? nowMs);

  state.lastRecentTracksFetchTime = new Date(cursorMs);
  state.lastFetchedAt = new Date(nowMs);

  if (page.hasRecentPlay) {
    state.lastActiveAt = new Date(nowMs);
  }
}

function collectLag(
  page: Page,
  plays: readonly number[],
  nowMs: number,
  lagSamples: number[],
): void {
  for (let index = page.start; index < page.start + page.count; index += 1) {
    const playMs = plays[index];

    if (playMs !== undefined) {
      lagSamples.push(nowMs - playMs);
    }
  }
}

function lagStats(samples: number[]): LagStats {
  if (samples.length === 0) {
    return { samples: 0, p50Ms: 0, p95Ms: 0, maxMs: 0 };
  }

  const sorted = [...samples].sort((left, right) => left - right);

  const rank = (fraction: number): number =>
    sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))] ?? 0;

  return {
    samples: sorted.length,
    p50Ms: rank(0.5),
    p95Ms: rank(0.95),
    maxMs: sorted.at(-1) ?? 0,
  };
}
