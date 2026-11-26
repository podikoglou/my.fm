import { parseArgs } from "node:util";

import type { DiurnalPattern } from "./population.ts";
import { formatSummaryTable } from "./report.ts";
import { expandSpecs, runSweep, type SweepConfig } from "./sweep.ts";

interface CliOptions {
  readonly users: readonly number[];
  readonly sessions: readonly number[];
  readonly sessionMinutes: number;
  readonly days: number;
  readonly warmupDays: number;
  readonly requestMs: number;
  readonly rateThreshold: number | null;
  readonly quotaThreshold: number | null;
  readonly diurnal: DiurnalPattern;
  readonly seed: number;
}

function parseNumberList(name: string, value: string | undefined): number[] {
  if (value === undefined) {
    throw new Error(`--${name} is required`);
  }

  const numbers = value
    .split(",")
    .map(Number)
    .filter((number) => Number.isFinite(number));

  if (numbers.length === 0 || numbers.some((number) => number < 1)) {
    throw new Error(`--${name} expects a comma list of positive numbers, got: ${value}`);
  }

  return numbers;
}

function parsePositiveInt(name: string, value: string | undefined): number {
  const number = Number(value);

  if (!Number.isInteger(number) || number < 1) {
    throw new Error(`--${name} expects a positive integer, got: ${value}`);
  }

  return number;
}

function parseThreshold(name: string, value: string | undefined): number | null {
  if (value === undefined || value === "none") {
    return null;
  }

  return parsePositiveInt(name, value);
}

function parseDiurnal(value: string | undefined): DiurnalPattern {
  if (value === "flat" || value === "evening") {
    return value;
  }

  throw new Error(`--diurnal expects "flat" or "evening", got: ${value}`);
}

function parseOptions(args: readonly string[]): CliOptions {
  const parsed = parseArgs({
    args,
    options: {
      users: { type: "string", default: "100" },
      sessions: { type: "string", default: "3" },
      "session-minutes": { type: "string", default: "45" },
      days: { type: "string", default: "7" },
      "warmup-days": { type: "string", default: "1" },
      "request-ms": { type: "string", default: "200" },
      "rate-threshold": { type: "string", default: "90" },
      "quota-threshold": { type: "string", default: "none" },
      diurnal: { type: "string", default: "evening" },
      seed: { type: "string", default: "7" },
    },
  });

  const days = parsePositiveInt("days", parsed.values.days);
  const warmupDays = parsePositiveInt("warmup-days", parsed.values["warmup-days"]);

  if (warmupDays >= days) {
    throw new Error("--warmup-days must be smaller than --days");
  }

  return {
    users: parseNumberList("users", parsed.values.users),
    sessions: parseNumberList("sessions", parsed.values.sessions),
    sessionMinutes: parsePositiveInt("session-minutes", parsed.values["session-minutes"]),
    days,
    warmupDays,
    requestMs: parsePositiveInt("request-ms", parsed.values["request-ms"]),
    rateThreshold: parseThreshold("rate-threshold", parsed.values["rate-threshold"]),
    quotaThreshold: parseThreshold("quota-threshold", parsed.values["quota-threshold"]),
    diurnal: parseDiurnal(parsed.values.diurnal),
    seed: parsePositiveInt("seed", parsed.values.seed),
  };
}

function main(args: readonly string[]): void {
  const options = parseOptions(args);

  const config: SweepConfig = {
    days: options.days,
    warmupDays: options.warmupDays,
    sessionMinutes: options.sessionMinutes,
    diurnal: options.diurnal,
    seed: options.seed,
    requestMs: options.requestMs,
    rateThreshold: options.rateThreshold,
    quotaThreshold: options.quotaThreshold,
  };

  const specs = expandSpecs(options.users, options.sessions);
  const summaries = runSweep(specs, config);

  console.log(formatSummaryTable(summaries, config));
}

main(process.argv.slice(2));
