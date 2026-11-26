export {
  PAGE_LIMIT,
  TICK_MS,
  simulateScenario,
  type EngineConfig,
  type LagStats,
  type ScenarioMetrics,
} from "./engine.ts";

export {
  composeLimiters,
  quotaLimiter,
  rateLimitLimiter,
  rollingWindowLimiter,
  unlimitedLimiter,
  TimeWindow,
  type DenialReason,
  type Limiter,
  type LimiterDecision,
} from "./limiter.ts";

export {
  countActiveUsers,
  generatePopulation,
  meanActiveShare,
  type DiurnalPattern,
  type Population,
  type PopulationConfig,
  type UserPlays,
} from "./population.ts";

export { formatDuration, formatNumber, formatSummaryTable } from "./report.ts";

export {
  expandSpecs,
  runScenario,
  runSweep,
  type ScenarioSpec,
  type ScenarioSummary,
  type SweepConfig,
  type Verdict,
} from "./sweep.ts";

export { makeRng, weightedIndex, type Rng } from "./rng.ts";
