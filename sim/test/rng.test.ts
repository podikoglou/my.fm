import { describe, expect, test } from "bun:test";

import { makeRng } from "../src/rng.ts";

describe("makeRng", () => {
  test("replays the same sequence from the same seed", () => {
    const first = makeRng(7);
    const second = makeRng(7);

    const sequence = Array.from({ length: 8 }, () => [first.next(), second.next()]);

    expect(sequence.every(([left, right]) => left === right)).toBe(true);
  });

  test("different seeds diverge", () => {
    const first = makeRng(7);
    const second = makeRng(8);

    expect(first.next()).not.toBe(second.next());
  });

  test("stays inside [0, 1)", () => {
    const rng = makeRng(1);

    for (let index = 0; index < 10_000; index += 1) {
      const value = rng.next();

      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  test("intBetween keeps the upper bound exclusive", () => {
    const rng = makeRng(3);

    for (let index = 0; index < 1000; index += 1) {
      const value = rng.intBetween(4, 9);

      expect(value).toBeGreaterThanOrEqual(4);
      expect(value).toBeLessThan(9);
    }
  });
});
