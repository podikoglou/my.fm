import { simulateScenario, type EngineConfig, type ScenarioMetrics } from "./engine.ts";
import { composeLimiters, quotaLimiter, rateLimitLimiter, unlimitedLimiter } from "./limiter.ts";
import { generatePopulation, type DiurnalPattern } from "./population.ts";

const DAY_MS = 24 * 60 * 60_000;

export interface SweepConfig {
  readonly days: number;
  readonly warmupDays: number;
  readonly sessionMinutes: number;
  readonly diurnal: DiurnalPattern;
  readonly seed: number;
  /** One sequential recently-played request, including latency. */
  readonly requestMs: number;
  /** Requests allowed per rolling 30 seconds; Spotify publishes no number. */
  readonly rateThreshold: number | null;
  /** Requests allowed per rolling 24 hours by the quota buckets; unpublished. */
  readonly quotaThreshold: number | null;
}

export interface ScenarioSpec {
  readonly users: number;
  readonly sessionsPerDay: number;
}

export type Verdict = "ok" | "rate-limited" | "quota";

export interface ScenarioSummary {
  readonly users: number;
  readonly sessionsPerDay: number;
  readonly metrics: ScenarioMetrics;
  readonly verdict: Verdict;
}

/** Distinct seeds per scenario so a sweep never replays one population. */
function scenarioSeed(seed: number, users: number, sessionsPerDay: number): number {
  return (seed * 1_000_003 + users * 10_007 + sessionsPerDay * 101) >>> 0;
}

export function runScenario(spec: ScenarioSpec, config: SweepConfig): ScenarioSummary {
  const population = generatePopulation({
    users: spec.users,
    days: config.days,
    sessionsPerDay: spec.sessionsPerDay,
    sessionMinutes: config.sessionMinutes,
    diurnal: config.diurnal,
    seed: scenarioSeed(config.seed, spec.users, spec.sessionsPerDay),
  });

  const limiter =
    config.rateThreshold === null && config.quotaThreshold === null
      ? unlimitedLimiter()
      : composeLimiters(
          [
            config.rateThreshold === null ? null : rateLimitLimiter(config.rateThreshold),
            config.quotaThreshold === null ? null : quotaLimiter(config.quotaThreshold),
          ].filter((limiter): limiter is NonNullable<typeof limiter> => limiter !== null),
        );

  const engineConfig: EngineConfig = {
    requestMs: config.requestMs,
    warmupMs: config.warmupDays * DAY_MS,
    limiter,
  };

  const metrics = simulateScenario(population, config.days * DAY_MS, engineConfig);

  const verdict: Verdict =
    metrics.deniedRateLimit > 0 ? "rate-limited" : metrics.deniedQuota > 0 ? "quota" : "ok";

  return { users: spec.users, sessionsPerDay: spec.sessionsPerDay, metrics, verdict };
}

export function runSweep(specs: readonly ScenarioSpec[], config: SweepConfig): ScenarioSummary[] {
  return specs.map((spec) => runScenario(spec, config));
}

/** The users × sessions-per-day grid a CLI sweep expands into. */
export function expandSpecs(
  users: readonly number[],
  sessionsPerDay: readonly number[],
): ScenarioSpec[] {
  const specs: ScenarioSpec[] = [];

  for (const usersCount of users) {
    for (const sessionsCount of sessionsPerDay) {
      specs.push({ users: usersCount, sessionsPerDay: sessionsCount });
    }
  }

  return specs;
}
