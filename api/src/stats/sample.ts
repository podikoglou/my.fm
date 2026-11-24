import type { SamplePoint } from "../db/queries/stats.ts";

/** Mulberry32: a small seeded generator, so one seed always draws one sample. */
function seededRandom(seed: number) {
  let state = seed >>> 0;

  return () => {
    state = (state + 0x6d_2b_79_f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);

    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/**
 * Split `[since, until)` (Unix seconds) into `size` equal strata and pick a
 * random instant in each, so the sample spreads across the whole history
 * instead of following the busiest periods.
 */
export function stratifiedPoints(
  since: number,
  until: number,
  size: number,
  seed: number,
): SamplePoint[] {
  const random = seededRandom(seed);
  const width = (until - since) / size;
  const points: SamplePoint[] = [];

  for (let index = 0; index < size; index += 1) {
    const start = Math.floor(since + index * width);
    const end = index === size - 1 ? until : Math.floor(since + (index + 1) * width);

    if (end > start) {
      points.push({ since: start, at: start + Math.floor(random() * (end - start)), until: end });
    }
  }

  return points;
}
