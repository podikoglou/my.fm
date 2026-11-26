import { Effect, Schema } from "effect";

import { DbLive, type DatabaseRequirements } from "../src/db/service.ts";

/**
 * The exact message the D1 binding throws once the account exceeds its daily
 * free-tier write limit.
 */
export const D1_WRITE_LIMIT_MESSAGE =
  "D1_ERROR: Your account has exceeded D1's free tier daily row write limit. " +
  "Upgrade to a paid plan or wait until tomorrow (midnight UTC) to continue. " +
  "See https://developers.cloudflare.com/d1/platform/limits/ for more details.";

type D1Value = string | number | boolean | ArrayBuffer | Uint8Array | null;

type D1InputValue = string | number | boolean | Date | null | undefined;

type D1Row = Record<string, D1Value>;

type DecodedRow = Record<string, D1Value | Date>;

type TestRow = Record<string, D1InputValue>;

const D1ValueSchema = Schema.Union([
  Schema.String,
  Schema.Finite,
  Schema.Boolean,
  Schema.instanceOf(ArrayBuffer),
  Schema.instanceOf(Uint8Array),
  Schema.Null,
] as const);

const DecodedRowSchema = Schema.Record(
  Schema.String,
  Schema.Union([D1ValueSchema, Schema.Date] as const),
);

const TestRowSchema = Schema.Record(
  Schema.String,
  Schema.Union([
    Schema.String,
    Schema.Finite,
    Schema.Boolean,
    Schema.Date,
    Schema.Null,
    Schema.Undefined,
  ] as const),
);

const fieldNames = {
  users: { emailVerified: "email_verified", updatedAt: "updated_at" },
  sessions: {
    expiresAt: "expires_at",
    createdAt: "created_at",
    updatedAt: "updated_at",
    ipAddress: "ip_address",
    userAgent: "user_agent",
    userId: "user_id",
  },
  accounts: {
    accountId: "account_id",
    providerId: "provider_id",
    userId: "user_id",
    accessToken: "access_token",
    refreshToken: "refresh_token",
    idToken: "id_token",
    accessTokenExpiresAt: "access_token_expires_at",
    refreshTokenExpiresAt: "refresh_token_expires_at",
    createdAt: "created_at",
    updatedAt: "updated_at",
  },
  verification: { expiresAt: "expires_at", createdAt: "created_at", updatedAt: "updated_at" },
  track_artists: { trackSpotifyUri: "track_spotify_uri", artistSpotifyUri: "artist_spotify_uri" },
  album_artists: { albumSpotifyUri: "album_spotify_uri", artistSpotifyUri: "artist_spotify_uri" },
} satisfies Record<string, Record<string, string>>;

const quote = (value: string) => `"${value.replaceAll('"', '""')}"`;

const fieldsForTable = (table: string) =>
  Object.entries(fieldNames).find(([name]) => name === table)?.[1];

const column = (table: string, field: string) => {
  const fields = fieldsForTable(table);

  return fields ? (Object.entries(fields).find(([name]) => name === field)?.[1] ?? field) : field;
};

function fieldFromColumn(table: string, name: string) {
  const fields = fieldsForTable(table);

  return fields
    ? (Object.entries(fields).find(([, columnName]) => columnName === name)?.[0] ?? name)
    : name;
}

function decode(table: string, row: D1Row): DecodedRow {
  const decoded = new Map<string, D1Value | Date>();

  for (const [name, value] of Object.entries(row)) {
    const field = fieldFromColumn(table, name);

    if (
      Schema.is(Schema.Finite)(value) &&
      ["isPrivate", "onboarded", "email_verified", "explicit"].includes(name)
    ) {
      decoded.set(field, value === 1);
      continue;
    }

    if (
      Schema.is(Schema.Finite)(value) &&
      ["createdAt", "scrobbleDate", "lastRecentTracksFetchTime"].includes(field)
    ) {
      decoded.set(field, new Date(value * 1000));
      continue;
    }

    if (
      Schema.is(Schema.Finite)(value) &&
      (field.endsWith("At") || field.endsWith("_at") || field === "blockedUntil")
    ) {
      decoded.set(field, new Date(value));
      continue;
    }

    decoded.set(field, value);
  }

  return Schema.decodeUnknownSync(DecodedRowSchema)(Object.fromEntries(decoded));
}

function encode(table: string, field: string, value: D1InputValue): D1Value {
  if (value === undefined) {
    throw new Error("Cannot bind undefined to D1");
  }

  if (Schema.is(Schema.Date)(value)) {
    if (["sessions", "accounts", "verification"].includes(table)) return value.getTime();

    return ["createdAt", "scrobbleDate", "lastRecentTracksFetchTime"].includes(field)
      ? Math.floor(value.getTime() / 1000)
      : value.getTime();
  }

  return Schema.is(Schema.Boolean)(value) ? Number(value) : value;
}

export async function executeSql(
  database: D1Database,
  query: string,
  values: ReadonlyArray<D1Value> = [],
) {
  const statement = database.prepare(query);

  return values.length === 0 ? statement.run() : statement.bind(...values).run();
}

export async function queryRows<T extends D1Row>(
  database: D1Database,
  query: string,
  values: ReadonlyArray<D1Value> = [],
): Promise<T[]> {
  const statement = database.prepare(query);

  const result =
    values.length === 0 ? await statement.all<T>() : await statement.bind(...values).all<T>();

  return result.results;
}

export async function insertRows(
  database: D1Database,
  table: string,
  input: ReadonlyArray<TestRow> | TestRow,
) {
  const rows = Schema.is(Schema.Array(TestRowSchema))(input) ? input : [input];

  if (rows.length === 0) return;

  const prepared = rows.map((row) => {
    const fields = Object.keys(row).filter((field) => row[field] !== undefined);

    if (fields.length === 0) {
      return database.prepare(`INSERT INTO ${quote(table)} DEFAULT VALUES`);
    }

    const statement = `INSERT INTO ${quote(table)} (${fields.map((field) => quote(column(table, field))).join(", ")}) VALUES (${fields.map(() => "?").join(", ")})`;

    return database
      .prepare(statement)
      .bind(...fields.map((field) => encode(table, field, row[field])));
  });

  const [single] = prepared;

  if (single && prepared.length === 1) {
    await single.run();

    return;
  }

  await database.batch(prepared);
}

export async function selectRows(
  database: D1Database,
  table: string,
  orderBy?: string,
): Promise<DecodedRow[]> {
  const order = orderBy ? ` ORDER BY ${quote(column(table, orderBy))}` : "";
  const rows = await queryRows(database, `SELECT * FROM ${quote(table)}${order}`);

  return rows.map((row) => decode(table, row));
}

export async function updateRows(
  database: D1Database,
  table: string,
  changes: TestRow,
  where: TestRow,
) {
  const set = Object.entries(changes).filter(([, value]) => value !== undefined);
  const predicates = Object.entries(where).filter(([, value]) => value !== undefined);

  if (set.length === 0) return;

  const conditionSql = predicates.map(([field, value]) =>
    value === null
      ? `${quote(column(table, field))} IS NULL`
      : `${quote(column(table, field))} = ?`,
  );

  await executeSql(
    database,
    `UPDATE ${quote(table)} SET ${set.map(([field]) => `${quote(column(table, field))} = ?`).join(", ")} WHERE ${conditionSql.join(" AND ")}`,
    [
      ...set.map(([field, value]) => encode(table, field, value)),
      ...predicates.flatMap(([field, value]) =>
        value === null ? [] : [encode(table, field, value)],
      ),
    ],
  );
}

export function runSql<A, E>(
  database: D1Database,
  effect: Effect.Effect<A, E, DatabaseRequirements>,
) {
  return Effect.runPromise(effect.pipe(Effect.provide(DbLive(database))));
}

const writeStatementPattern = /^\s*(insert|update|delete)\b/i;

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
      new RegExp(`^\\s*insert\\s+into\\s+["\`]?${table}["\`]?\\s`, "i").test(sql)
        ? rejectingStatement(database, message)
        : database.prepare(sql),
  });
}
