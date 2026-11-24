/**
 * The exact message the D1 binding throws once the account exceeds its daily
 * free-tier write limit.
 */
export const D1_WRITE_LIMIT_MESSAGE =
  "D1_ERROR: Your account has exceeded D1's free tier daily row write limit. " +
  "Upgrade to a paid plan or wait until tomorrow (midnight UTC) to continue. " +
  "See https://developers.cloudflare.com/d1/platform/limits/ for more details.";

const writeStatementPattern = /^(insert|update|delete)\b/i;

function rejectingStatement(database: D1Database, message: string): D1PreparedStatement {
  const base = database.prepare("SELECT 1");

  const reject = async (): Promise<never> => {
    throw new Error(message);
  };

  const statement: D1PreparedStatement = {
    bind: () => statement,
    all: reject,
    first: reject,
    raw: reject,
    run: reject,
  };

  // Keep prototype methods if any exist on the runtime prepared statement.
  void base;

  return statement;
}

function wrapDatabase(
  database: D1Database,
  overrides: Partial<Pick<D1Database, "prepare" | "batch">>,
): D1Database {
  return {
    prepare: overrides.prepare ?? ((sql: string) => database.prepare(sql)),
    batch: overrides.batch ?? ((statements: D1PreparedStatement[]) => database.batch(statements)),
    exec: (query: string) => database.exec(query),
    dump: () => database.dump(),
    withSession: (constraintOrBookmark?: D1SessionConstraint | D1SessionBookmark) =>
      database.withSession(constraintOrBookmark),
  };
}

export function createBatchWriteLimitDatabase(database: D1Database): D1Database {
  return wrapDatabase(database, {
    batch: () => Promise.reject(new Error(D1_WRITE_LIMIT_MESSAGE)),
  });
}

export function createStatementWriteLimitDatabase(database: D1Database): D1Database {
  return wrapDatabase(database, {
    prepare: (sql: string) =>
      writeStatementPattern.test(sql)
        ? rejectingStatement(database, D1_WRITE_LIMIT_MESSAGE)
        : database.prepare(sql),
  });
}

export function createFailingInsertDatabase(
  table: string,
  message: string,
  database: D1Database,
): D1Database {
  return wrapDatabase(database, {
    prepare: (sql: string) =>
      sql.toLowerCase().startsWith(`insert into "${table}"`)
        ? rejectingStatement(database, message)
        : database.prepare(sql),
  });
}
