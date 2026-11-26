/**
 * Which Spotify limiter rejected a request: the rolling 30-second window, or
 * the development-mode quota buckets that share a per-developer-account daily
 * allowance.
 */
export type DenialReason = "rate-limit" | "quota";

export type LimiterDecision =
  | { readonly allowed: true }
  | {
      readonly allowed: false;
      readonly reason: DenialReason;
      readonly retryAfterSeconds: number;
    };

export interface Limiter {
  /**
   * Record a request attempt at `atMs` (ms since the simulation start).
   *
   * A denied attempt is not recorded against the limiter's own window: the
   * ingestion run honours `retryAfterSeconds`, so by the time it retries, the
   * window has drained either way.
   */
  attempt(atMs: number): LimiterDecision;
}

/**
 * Timestamps inside a rolling window, oldest first.
 *
 * A head index with occasional compaction keeps pruning O(1) per attempt even
 * when the window holds a day of traffic.
 */
export class TimeWindow {
  private readonly times: number[] = [];
  private head = 0;

  constructor(private readonly windowMs: number) {}

  push(...timestampsMs: number[]): void {
    this.times.push(...timestampsMs);
  }

  /** Drop timestamps that left the window by `cutoffMs` (inclusive). */
  prune(cutoffMs: number): void {
    while (this.head < this.times.length) {
      const oldest = this.times[this.head];

      if (oldest === undefined || oldest > cutoffMs) {
        break;
      }

      this.head += 1;
    }

    if (this.head > 1000 && this.head * 2 > this.times.length) {
      this.times.splice(0, this.head);
      this.head = 0;
    }
  }

  /** Requests currently inside the window. */
  get size(): number {
    return this.times.length - this.head;
  }

  /** Oldest timestamp inside the window, `undefined` when empty. */
  get oldest(): number | undefined {
    return this.times[this.head];
  }

  get windowLengthMs(): number {
    return this.windowMs;
  }
}

/** Seconds until the oldest timestamp leaves the window, at least one. */
function drainSeconds(window: TimeWindow, atMs: number): number {
  const oldest = window.oldest;

  const untilMs = oldest === undefined ? atMs : oldest + window.windowLengthMs - atMs;

  return Math.max(1, Math.ceil(untilMs / 1000));
}

/** A request succeeds while fewer than `threshold` attempts sit inside `windowMs`. */
export function rollingWindowLimiter(
  windowMs: number,
  threshold: number,
  reason: DenialReason,
): Limiter {
  const window = new TimeWindow(windowMs);

  return {
    attempt(atMs: number): LimiterDecision {
      window.prune(atMs - windowMs);

      if (window.size >= threshold) {
        return { allowed: false, reason, retryAfterSeconds: drainSeconds(window, atMs) };
      }

      window.push(atMs);

      return { allowed: true };
    },
  };
}

/** Spotify's app-wide limit: a rolling 30-second window per developer account. */
export function rateLimitLimiter(thresholdPer30s: number): Limiter {
  return rollingWindowLimiter(30_000, thresholdPer30s, "rate-limit");
}

/**
 * Spotify's development-mode quota buckets: a rolling 24-hour allowance per
 * developer account, shared across endpoints in a bucket.
 *
 * Spotify documents the bucket structure but not the limits; the threshold is
 * a sweep parameter, not a known constant.
 */
export function quotaLimiter(thresholdPer24h: number): Limiter {
  return rollingWindowLimiter(24 * 60 * 60_000, thresholdPer24h, "quota");
}

/** A limiter that never denies, for measuring raw traffic. */
export function unlimitedLimiter(): Limiter {
  return { attempt: () => ({ allowed: true }) };
}

/**
 * The first limiter that denies wins and the attempt is not offered to the
 * rest; an allowed request is recorded against all of them.
 */
export function composeLimiters(limiters: readonly Limiter[]): Limiter {
  return {
    attempt: (atMs: number) => {
      for (const limiter of limiters) {
        const decision = limiter.attempt(atMs);

        if (!decision.allowed) {
          return decision;
        }
      }

      return { allowed: true };
    },
  };
}
