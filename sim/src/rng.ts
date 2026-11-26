/**
 * Deterministic PRNG so a scenario reruns identically from its seed.
 */
export interface Rng {
  /** Next float in [0, 1). */
  next(): number;

  /** Next float in [min, max). */
  floatBetween(min: number, max: number): number;

  /** Next integer in [min, max) — the upper bound is exclusive. */
  intBetween(minInclusive: number, maxExclusive: number): number;
}

/**
 * Mulberry32: small, fast, and stable across Bun and Node versions, which a
 * platform PRNG does not guarantee.
 */
export function makeRng(seed: number): Rng {
  let state = seed >>> 0;

  const next = (): number => {
    state = (state + 0x6d_2b_79_f5) >>> 0;

    let mixed = state;

    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);

    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4_294_967_296;
  };

  return {
    next,
    floatBetween: (min, max) => min + next() * (max - min),
    intBetween: (minInclusive, maxExclusive) =>
      minInclusive + Math.floor(next() * (maxExclusive - minInclusive)),
  };
}

/**
 * Sample an index in proportion to `weights` (cumulative form, from
 * `cumulativeWeights`).
 */
export function weightedIndex(rng: Rng, cumulative: readonly number[]): number {
  const target = rng.next() * (cumulative.at(-1) ?? 0);

  for (let index = 0; index < cumulative.length - 1; index++) {
    const bound = cumulative.at(index);

    if (bound !== undefined && target < bound) {
      return index;
    }
  }

  return cumulative.length - 2;
}
