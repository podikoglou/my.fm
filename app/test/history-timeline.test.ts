import { describe, expect, test } from "vitest";

import {
  formatScrobbleDate,
  monthAt,
  pagesBetween,
  rowAddress,
  rowsInView,
  toMonths,
  totalPlays,
} from "../app/lib/history-timeline.ts";

const months = toMonths([
  { month: "2023-10", count: 3 },
  { month: "2023-09", count: 10 },
  { month: "2023-08", count: 5 },
]);

describe("toMonths", () => {
  test("gives each month the index of its first row, newest month first", () => {
    expect(months.map(({ key, start }) => [key, start])).toEqual([
      ["2023-10", 0],
      ["2023-09", 3],
      ["2023-08", 13],
    ]);
  });

  test("labels the month and ends it at local midnight on the next 1st", () => {
    const [, september] = months;

    expect(september.label).toBe("September 2023");
    expect(september.shortLabel).toBe("Sep 2023");
    expect(september.before).toBe(new Date(2023, 9, 1).getTime() / 1000);
  });

  test("rolls December over into the next year", () => {
    const [december] = toMonths([{ month: "2022-12", count: 1 }]);

    expect(december.before).toBe(new Date(2023, 0, 1).getTime() / 1000);
  });
});

describe("totalPlays", () => {
  test("adds up every month", () => {
    expect(totalPlays(months)).toBe(18);
    expect(totalPlays([])).toBe(0);
  });
});

describe("monthAt", () => {
  test("finds the month a row belongs to at both edges of a month", () => {
    expect(monthAt(months, 0).key).toBe("2023-10");
    expect(monthAt(months, 2).key).toBe("2023-10");
    expect(monthAt(months, 3).key).toBe("2023-09");
    expect(monthAt(months, 12).key).toBe("2023-09");
    expect(monthAt(months, 17).key).toBe("2023-08");
  });
});

describe("rowAddress", () => {
  test("pages from the start of the row's own month", () => {
    const { month, page, slot } = rowAddress(months, 12);

    expect([month.key, page, slot]).toEqual(["2023-09", 1, 1]);
  });
});

describe("rowsInView", () => {
  test("adds two rows of overscan on each side", () => {
    expect(rowsInView(560, 448, 100)).toEqual({ first: 8, last: 20 });
  });

  test("stays inside the list", () => {
    expect(rowsInView(0, 448, 5)).toEqual({ first: 0, last: 4 });
  });
});

describe("pagesBetween", () => {
  test("lists each page once, split at month boundaries", () => {
    const pages = pagesBetween(months, { first: 1, last: 14 });

    expect(pages.map(({ month, page }) => [month.key, page])).toEqual([
      ["2023-10", 0],
      ["2023-09", 0],
      ["2023-09", 1],
      ["2023-08", 0],
    ]);
  });
});

describe("formatScrobbleDate", () => {
  const time = (date: Date) =>
    date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

  test("shows the weekday and day, and the month only when asked", () => {
    const date = new Date(2023, 8, 30, 22, 31);

    expect(formatScrobbleDate(date, false)).toBe(`Sat 30, ${time(date)}`);
    expect(formatScrobbleDate(date, true)).toBe(`Sat 30 Sep, ${time(date)}`);
  });

  test("says Today for a play from today", () => {
    const date = new Date();

    expect(formatScrobbleDate(date, true)).toBe(`Today, ${time(date)}`);
  });
});
