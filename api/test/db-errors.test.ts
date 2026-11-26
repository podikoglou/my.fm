import { Predicate } from "effect";
import * as SqlError from "effect/sql/SqlError";
import { describe, expect, test } from "vitest";

import {
  classifyDbError,
  D1QueryError,
  D1QuotaExceededError,
  describeError,
  getD1QuotaError,
  mapSqlError,
} from "../src/db/errors.ts";

// The exact message the D1 binding throws, kept here so the classifier and the
// test database wrappers cannot drift together.
const WRITE_LIMIT_MESSAGE =
  "D1_ERROR: Your account has exceeded D1's free tier daily row write limit. " +
  "Upgrade to a paid plan or wait until tomorrow (midnight UTC) to continue. " +
  "See https://developers.cloudflare.com/d1/platform/limits/ for more details.";

const READ_LIMIT_MESSAGE =
  "D1_ERROR: Your account has exceeded D1's free tier daily row read limit. " +
  "Upgrade to a paid plan or wait until tomorrow (midnight UTC) to continue. " +
  "See https://developers.cloudflare.com/d1/platform/limits/ for more details.";

/** A write-limit error wrapped by Effect SQL. */
function wrappedWriteLimit(): SqlError.SqlError {
  return new SqlError.SqlError({
    reason: new SqlError.UnknownError({
      cause: new Error(WRITE_LIMIT_MESSAGE),
      message: "SQL query failed",
    }),
  });
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

  test("finds the limit under a SqlError wrapper", () => {
    expect(getD1QuotaError(wrappedWriteLimit())).toEqual({ limit: "row-write" });
  });

  test("returns null for an unrelated D1 error", () => {
    expect(getD1QuotaError(new Error("D1_ERROR: FOREIGN KEY constraint failed"))).toBeNull();
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
      name: "effect/sql/SqlError",
      message: "SQL query failed",
      causes: expect.arrayContaining([WRITE_LIMIT_MESSAGE]),
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

describe("classifyDbError", () => {
  test("maps quota errors to D1QuotaExceededError", () => {
    const error = mapSqlError(wrappedWriteLimit());

    expect(error).toBeInstanceOf(D1QuotaExceededError);
    expect(error._tag).toBe("D1QuotaExceededError");

    if (Predicate.isTagged(error, "D1QuotaExceededError")) {
      expect(error.limit).toBe("row-write");
    }
  });

  test("maps unrelated errors to D1QueryError with cause chain", () => {
    const error = classifyDbError(new Error("D1_ERROR: FOREIGN KEY constraint failed"));

    expect(error).toBeInstanceOf(D1QueryError);
    expect(error._tag).toBe("D1QueryError");

    if (Predicate.isTagged(error, "D1QueryError")) {
      expect(error.description.message).toBe("D1_ERROR: FOREIGN KEY constraint failed");
    }
  });
});
