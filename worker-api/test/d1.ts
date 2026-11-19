/**
 * The exact message the D1 binding throws once the account exceeds its daily
 * free-tier write limit.
 */
export const D1_WRITE_LIMIT_MESSAGE =
  "D1_ERROR: Your account has exceeded D1's free tier daily row write limit. " +
  "Upgrade to a paid plan or wait until tomorrow (midnight UTC) to continue. " +
  "See https://developers.cloudflare.com/d1/platform/limits/ for more details.";

/** SQL that D1 counts as written rows. */
const writeStatementPattern = /^(insert|update|delete)\b/i;

function asD1Database<T>(value: T): D1Database {
  // SAFETY: `value` implements `prepare` and `batch`, the two members that
  // Drizzle's D1 driver calls; the rest of the binding is unreachable here.
  return value as D1Database;
}

function asD1PreparedStatement<T>(value: T): D1PreparedStatement {
  // SAFETY: `value` implements every method that Drizzle's D1 driver calls on
  // a prepared statement.
  return value as D1PreparedStatement;
}

/**
 * A statement that rejects like the binding does. The methods return rejected
 * promises because a synchronous throw skips Drizzle's error wrapper and
 * would not reproduce the wrapped error that production sees.
 */
function rejectingStatement(message: string): D1PreparedStatement {
  const reject = async () => {
    throw new Error(message);
  };

  const statement: D1PreparedStatement = asD1PreparedStatement({
    bind: () => statement,
    all: reject,
    first: reject,
    raw: reject,
    run: reject,
  });

  return statement;
}

/**
 * A database whose `batch` rejects with the D1 write-limit error, as the
 * binding does once the account exceeds its daily row writes. Single
 * statements run for real, so a test can seed and assert through the tables.
 */
export function createBatchWriteLimitDatabase(database: D1Database): D1Database {
  return asD1Database({
    prepare: (sql: string) => database.prepare(sql),
    batch: () => Promise.reject(new Error(D1_WRITE_LIMIT_MESSAGE)),
  });
}

/**
 * A database whose write statements reject with the D1 write-limit error, so
 * Drizzle wraps the message in a `DrizzleQueryError` with the binding error as
 * its cause. Reads pass through.
 */
export function createStatementWriteLimitDatabase(database: D1Database): D1Database {
  return asD1Database({
    prepare: (sql: string) =>
      writeStatementPattern.test(sql)
        ? rejectingStatement(D1_WRITE_LIMIT_MESSAGE)
        : database.prepare(sql),
    batch: (statements: D1PreparedStatement[]) => database.batch(statements),
  });
}

/**
 * A database whose update statements reject with the given error, while
 * inserts and reads pass through.
 */
export function createFailingUpdateDatabase(message: string, database: D1Database): D1Database {
  return asD1Database({
    prepare: (sql: string) =>
      /^update\b/i.test(sql) ? rejectingStatement(message) : database.prepare(sql),
    batch: (statements: D1PreparedStatement[]) => database.batch(statements),
  });
}
