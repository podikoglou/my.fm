/**
 * A namespace id is account-scoped, so the two policies need different ids to
 * keep separate budgets. A second stage reuses these ids and therefore shares
 * the counters.
 */
export const RATE_LIMITS = {
  AUTH_RATE_LIMIT: { namespaceId: 1001, limit: 60, period: 60 },

  /** A profile view costs two requests, so the read budget is double. */
  PUBLIC_READ_RATE_LIMIT: { namespaceId: 1002, limit: 120, period: 60 },

  /**
   * Statistics aggregate a profile's whole history in one call, so they also
   * spend this smaller budget on top of the public-read one.
   */
  STATS_RATE_LIMIT: { namespaceId: 1003, limit: 10, period: 60 },
} as const;

/** A Rate Limiting binding, named as it is on the Worker environment. */
export type RateLimitBindingName = keyof typeof RATE_LIMITS;

/** The part of the Rate Limiting binding that the middleware calls. */
export type RateLimitBinding = {
  limit(options: { key: string }): Promise<{ success: boolean }>;
};
