import { describe, expect, test } from "bun:test";
import { DrizzleQueryError } from "drizzle-orm/errors";

import { describeError, getD1QuotaError } from "../src/db/errors.ts";

// The exact message the D1 binding throws, kept here so the classifier and the
// harness fixture cannot drift together.
const WRITE_LIMIT_MESSAGE =
  "D1_ERROR: Your account has exceeded D1's free tier daily row write limit. " +
  "Upgrade to a paid plan or wait until tomorrow (midnight UTC) to continue. " +
  "See https://developers.cloudflare.com/d1/platform/limits/ for more details.";

const READ_LIMIT_MESSAGE =
  "D1_ERROR: Your account has exceeded D1's free tier daily row read limit. " +
  "Upgrade to a paid plan or wait until tomorrow (midnight UTC) to continue. " +
  "See https://developers.cloudflare.com/d1/platform/limits/ for more details.";

/** A wrapper with a write-limit error at the bottom, as Drizzle produces it. */
function wrappedWriteLimit(): Error {
  return new DrizzleQueryError(
    'insert into "ingestion_runs" (id) values (?)',
    undefined,
    new Error(WRITE_LIMIT_MESSAGE),
  );
}

/** An error chain of the given labels over a bottom error. */
function chainOver(bottom: Error, labels: string[]): Error {
  let chained = bottom;

  for (const label of labels) {
    chained = new Error(label, { cause: chained });
  }

  return chained;
}

describe("getD1QuotaError", () => {
  test("classifies the binding's write-limit error", () => {
    expect(getD1QuotaError(new Error(WRITE_LIMIT_MESSAGE))).toEqual({ limit: "row-write" });
  });

  test("classifies the binding's read-limit error", () => {
    expect(getD1QuotaError(new Error(READ_LIMIT_MESSAGE))).toEqual({ limit: "row-read" });
  });

  test("finds the limit under a drizzle wrapper", () => {
    expect(getD1QuotaError(wrappedWriteLimit())).toEqual({ limit: "row-write" });
  });

  test("returns null for an unrelated D1 error", () => {
    expect(getD1QuotaError(new Error("D1_ERROR: FOREIGN KEY constraint failed"))).toBeNull();
  });

  test("returns null when the cause is not an error", () => {
    const error = new Error("Failed query: select from imports");
    error.cause = "a string";

    expect(getD1QuotaError(error)).toBeNull();
  });

  test("stops walking after four errors in the chain", () => {
    const chained = chainOver(new Error(WRITE_LIMIT_MESSAGE), [
      "layer 1",
      "layer 2",
      "layer 3",
      "layer 4",
    ]);

    expect(getD1QuotaError(chained)).toBeNull();
  });
});

describe("describeError", () => {
  test("carries the cause messages below the wrapper", () => {
    expect(describeError(wrappedWriteLimit())).toEqual({
      name: "DrizzleQueryError",
      message: 'Failed query: insert into "ingestion_runs" (id) values (?)',
      causes: [WRITE_LIMIT_MESSAGE],
    });
  });

  test("returns no causes for a plain error", () => {
    expect(describeError(new Error("metadata endpoint unavailable"))).toEqual({
      name: "Error",
      message: "metadata endpoint unavailable",
      causes: [],
    });
  });

  test("keeps the classifier's depth bound", () => {
    const chained = chainOver(new Error(WRITE_LIMIT_MESSAGE), [
      "layer 1",
      "layer 2",
      "layer 3",
      "layer 4",
    ]);

    expect(describeError(chained).causes).toEqual(["layer 3", "layer 2", "layer 1"]);
  });
});
