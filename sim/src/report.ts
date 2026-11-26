import type { ScenarioSummary, SweepConfig } from "./sweep.ts";
import {
  ACTIVE_FETCH_INTERVAL_MS,
  INACTIVE_FETCH_INTERVAL_MS,
  ACTIVE_WINDOW_MS,
} from "../../api/src/ingestion/schedule.ts";

const DAY_MS = 24 * 60 * 60_000;

/** `2m 10s`-style duration, rounded up to the next second. */
export function formatDuration(ms: number): string {
  const totalSeconds = Math.ceil(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  if (minutes === 0) {
    return `${seconds}s`;
  }

  const hours = Math.floor(minutes / 60);

  if (hours === 0) {
    return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
  }

  return `${hours}h ${String(minutes % 60).padStart(2, "0")}m`;
}

/** Group thousands with thin spaces so wide columns stay readable. */
export function formatNumber(value: number): string {
  const digits = Math.round(value).toString();

  return digits.replaceAll(/\B(?=(\d{3})+(?!\d))/g, " ");
}

function formatPercent(fraction: number): string {
  return `${(fraction * 100).toFixed(1)}%`;
}

function right(value: string, width: number): string {
  return value.padStart(width);
}

interface Column {
  readonly title: string;
  readonly width: number;
  readonly render: (summary: ScenarioSummary) => string;
}

const COLUMNS: readonly Column[] = [
  { title: "users", width: 7, render: (s) => String(s.users) },
  { title: "sess", width: 5, render: (s) => String(s.sessionsPerDay) },
  { title: "active", width: 7, render: (s) => formatPercent(s.metrics.meanActiveShare) },
  {
    title: "req/day",
    width: 8,
    render: (s) => formatNumber(s.metrics.requestsPerDay),
  },
  { title: "peak30s", width: 8, render: (s) => String(s.metrics.peak30s) },
  { title: "peak24h", width: 9, render: (s) => formatNumber(s.metrics.peak24h) },
  { title: "maxtick", width: 8, render: (s) => String(s.metrics.maxTickAttempts) },
  {
    title: "429",
    width: 4,
    render: (s) => String(s.metrics.deniedRateLimit + s.metrics.deniedQuota),
  },
  {
    title: "throttle%",
    width: 10,
    render: (s) =>
      formatPercent(
        s.metrics.throttledTicks / Math.max(1, (s.metrics.measuredDays * DAY_MS) / 60_000),
      ),
  },
  { title: "lagp50", width: 7, render: (s) => formatDuration(s.metrics.lag.p50Ms) },
  { title: "lagp95", width: 7, render: (s) => formatDuration(s.metrics.lag.p95Ms) },
  { title: "verdict", width: 12, render: (s) => s.verdict },
];

export function formatSummaryTable(
  summaries: readonly ScenarioSummary[],
  config: SweepConfig,
): string {
  const header = COLUMNS.map((column) => right(column.title, column.width)).join("  ");
  const separator = COLUMNS.map((column) => "-".repeat(column.width)).join("  ");

  const rows = summaries.map((summary) =>
    COLUMNS.map((column) => right(column.render(summary), column.width)).join("  "),
  );

  const rateLimit = config.rateThreshold === null ? "off" : `${config.rateThreshold}/30s`;

  const quota =
    config.quotaThreshold === null ? "off" : `${formatNumber(config.quotaThreshold)}/24h`;

  const diurnal = config.diurnal === "evening" ? "evening-weighted" : "flat";

  const lines = [
    "Spotify ingestion simulator",
    "",
    `schedule   cron 1 min · active ${ACTIVE_FETCH_INTERVAL_MS / 60_000} min · inactive ${INACTIVE_FETCH_INTERVAL_MS / 60_000} min · activity window ${ACTIVE_WINDOW_MS / 60_000} min · page 50 plays`,
    `limiters   rate limit ${rateLimit} · daily quota ${quota} · ${config.requestMs} ms/request`,
    `population ${config.days} days (${config.warmupDays} warmup) · ${diurnal} · seed ${config.seed}`,
    "",
    header,
    separator,
    ...rows,
    "",
    "verdict    ok = no rejection in the measured window · rate-limited = the rolling",
    "           30 s window denied requests · quota = the daily bucket denied requests",
    "cold start a reset cursor makes every user due in one tick; at the requestMs above,",
    `           a single 30 s window fits ${Math.floor(30_000 / Math.max(1, config.requestMs))} of them`,
  ];

  return lines.join("\n");
}
