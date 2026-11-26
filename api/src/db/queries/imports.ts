import { Effect, Option, Schema } from "effect";
import { SqlClient, SqlSchema } from "effect/sql";

import { asDbError } from "../service.ts";
import { ImportRow, type Import, type ImportInsert, type User } from "../schema.ts";

const ACTIVE_STATUSES = ["pending", "processing"] as const;

const encodeImport = (values: ImportInsert) => {
  const { createdAt, updatedAt, ...rest } = values;

  const encoded: Omit<ImportInsert, "createdAt" | "updatedAt"> & {
    createdAt?: number | null;
    updatedAt: number;
  } = {
    ...rest,
    updatedAt: updatedAt?.getTime() ?? Date.now(),
  };

  if (createdAt !== undefined) {
    encoded.createdAt = createdAt === null ? null : Math.floor(createdAt.getTime() / 1000);
  }

  return encoded;
};

export const insertImport = Effect.fn("imports.insert")(function* (values: ImportInsert) {
  const sql = yield* SqlClient.SqlClient;

  const find = SqlSchema.findOneOption({
    Request: Schema.Void,
    Result: ImportRow,
    execute: () =>
      sql`INSERT INTO imports ${sql.insert(encodeImport(values))} ON CONFLICT DO NOTHING RETURNING *`,
  });

  const result = yield* asDbError(find(undefined));

  return Option.getOrUndefined(result);
});

export const findActiveImportForCron = Effect.fn("imports.findActiveForCron")(function* () {
  const sql = yield* SqlClient.SqlClient;

  const find = SqlSchema.findOneOption({
    Request: Schema.Void,
    Result: ImportRow,
    execute: () =>
      sql`SELECT * FROM imports WHERE ${sql.in("status", ACTIVE_STATUSES)} ORDER BY createdAt LIMIT 1`,
  });

  const result = yield* asDbError(find(undefined));

  return Option.getOrUndefined(result);
});

export const findUserActiveImport = Effect.fn("imports.findUserActive")(function* (
  userId: User["id"],
) {
  const sql = yield* SqlClient.SqlClient;

  const find = SqlSchema.findOneOption({
    Request: Schema.Struct({ userId: Schema.String }),
    Result: ImportRow,
    execute: ({ userId }) =>
      sql`SELECT * FROM imports WHERE userId = ${userId} AND ${sql.in("status", ACTIVE_STATUSES)} LIMIT 1`,
  });

  const result = yield* asDbError(find({ userId }));

  return Option.getOrUndefined(result);
});

export const findUserRecentImport = Effect.fn("imports.findUserRecent")(function* (
  userId: User["id"],
  since: Date,
) {
  const sql = yield* SqlClient.SqlClient;

  const find = SqlSchema.findOneOption({
    Request: Schema.Struct({ userId: Schema.String, since: Schema.Int }),
    Result: ImportRow,
    execute: ({ userId, since }) =>
      sql`SELECT * FROM imports WHERE userId = ${userId} AND createdAt > ${since} ORDER BY createdAt DESC LIMIT 1`,
  });

  const result = yield* asDbError(find({ userId, since: Math.floor(since.getTime() / 1000) }));

  return Option.getOrUndefined(result);
});

export const findLatestImportByUserId = Effect.fn("imports.findLatestByUserId")(function* (
  userId: User["id"],
) {
  const sql = yield* SqlClient.SqlClient;

  const find = SqlSchema.findOneOption({
    Request: Schema.Struct({ userId: Schema.String }),
    Result: ImportRow,
    execute: ({ userId }) =>
      sql`SELECT * FROM imports WHERE userId = ${userId} ORDER BY createdAt DESC LIMIT 1`,
  });

  const result = yield* asDbError(find({ userId }));

  return Option.getOrUndefined(result);
});

export type UpdateImportValues = {
  readonly status?: "pending" | "processing" | "completed" | "failed";
  readonly cursor?: number;
  readonly totalLines?: number;
  readonly processedRows?: number;
  readonly skippedRows?: number;
  readonly attemptCount?: number;
  readonly error?: string | null;
  readonly updatedAt?: Date;
};

const encodeUpdate = (values: UpdateImportValues) => ({
  ...values,
  updatedAt: values.updatedAt?.getTime() ?? Date.now(),
});

export const updateImport = Effect.fn("imports.update")(function* (
  id: Import["id"],
  values: UpdateImportValues,
) {
  const sql = yield* SqlClient.SqlClient;
  yield* asDbError(sql`UPDATE imports SET ${sql.update(encodeUpdate(values))} WHERE id = ${id}`);
});

export const updateImportAtCursor = Effect.fn("imports.updateAtCursor")(function* (
  { id, cursor }: Pick<Import, "id" | "cursor">,
  values: UpdateImportValues,
) {
  const sql = yield* SqlClient.SqlClient;

  const find = SqlSchema.findAll({
    Request: Schema.Struct({
      id: Schema.String,
      cursor: Schema.Int,
      updates: Schema.Record(Schema.String, Schema.Unknown),
    }),
    Result: Schema.Struct({ id: Schema.String }),
    execute: ({ id, cursor, updates }) =>
      sql`UPDATE imports SET ${sql.update(updates)} WHERE id = ${id} AND cursor = ${cursor} AND ${sql.in("status", ACTIVE_STATUSES)} RETURNING id`,
  });

  const updated = yield* asDbError(find({ id, cursor, updates: encodeUpdate(values) }));

  return updated.length > 0;
});
