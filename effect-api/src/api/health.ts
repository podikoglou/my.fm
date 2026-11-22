import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from "effect/http-api";

/**
 * Age threshold before `/health/ingestion` reports stale.
 *
 * Matches the existing 20-minute cron staleness window.
 */
export const INGESTION_STALE_AFTER_MS = 20 * 60_000;

export const HealthOkResponse = Schema.Struct({
  status: Schema.Literal("ok"),
  database: Schema.Literal("ok"),
});

export const HealthUnavailableResponse = Schema.Struct({
  status: Schema.Literal("error"),
  database: Schema.Literal("error"),
}).pipe(HttpApiSchema.status(503));

export const IngestionHealthOkResponse = Schema.Struct({
  status: Schema.Literal("ok"),
  lastRunAt: Schema.NullOr(Schema.String),
  lastRunStatus: Schema.NullOr(Schema.String),
  blockedUntil: Schema.NullOr(Schema.String),
  ageSeconds: Schema.NullOr(Schema.Finite),
});

export const IngestionHealthStaleResponse = Schema.Struct({
  status: Schema.Literal("stale"),
  lastRunAt: Schema.NullOr(Schema.String),
  lastRunStatus: Schema.NullOr(Schema.String),
  blockedUntil: Schema.NullOr(Schema.String),
  ageSeconds: Schema.NullOr(Schema.Finite),
}).pipe(HttpApiSchema.status(503));

/**
 * Root health endpoints, kept at `/health` and `/health/ingestion` where
 * monitoring expects them.
 */
export class HealthGroup extends HttpApiGroup.make("health", { topLevel: true })
  .add(
    HttpApiEndpoint.get("health", "/health", {
      success: HealthOkResponse,
      error: HealthUnavailableResponse,
    }),
  )
  .add(
    HttpApiEndpoint.get("ingestionHealth", "/health/ingestion", {
      success: IngestionHealthOkResponse,
      error: IngestionHealthStaleResponse,
    }),
  ) {}
