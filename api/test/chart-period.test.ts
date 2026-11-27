import { expect, test } from "vitest";
import { chartWindow } from "../src/stats/period.ts";

test("today uses local midnights even when the clocks change", () => {
  const now = new Date("2026-10-25T13:00:00Z");
  expect(chartWindow("today", now, "Europe/Athens")).toEqual({
    since: Date.parse("2026-10-24T21:00:00Z") / 1000,
    until: now.getTime() / 1000 + 1,
    dayEnd: Date.parse("2026-10-25T22:00:00Z") / 1000,
  });
});

test("rolling windows measure elapsed days, not calendar boundaries", () => {
  const now = new Date("2026-03-01T12:34:56Z");
  const until = now.getTime() / 1000 + 1;

  for (const [period, days] of [
    ["week", 7],
    ["month", 30],
    ["sixMonths", 180],
    ["year", 365],
  ] as const) {
    expect(chartWindow(period, now)).toEqual({ since: until - days * 86_400, until });
  }
});
