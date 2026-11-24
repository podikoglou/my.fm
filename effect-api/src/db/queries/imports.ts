import { and, desc, eq, gt, inArray } from "drizzle-orm";

import type { Import, ImportInsert, User } from "../schema.ts";
import type { DrizzleDatabase } from "../service.ts";

import { imports } from "../schema.ts";

/**
 * Record an import. Returns nothing when the user already has an active
 * import: the unique index on active imports rejects the row, which closes
 * the gap between a route's check and its insert.
 */
export async function insertImport(
  db: DrizzleDatabase,
  values: ImportInsert,
): Promise<Import | undefined> {
  const [row] = await db.insert(imports).values(values).onConflictDoNothing().returning();

  return row;
}

export async function findActiveImportForCron(db: DrizzleDatabase): Promise<Import | undefined> {
  const [active] = await db
    .select()
    .from(imports)
    .where(inArray(imports.status, ["pending", "processing"]))
    .orderBy(imports.createdAt)
    .limit(1);

  return active;
}

export async function findUserActiveImport(
  db: DrizzleDatabase,
  userId: User["id"],
): Promise<Import | undefined> {
  const [active] = await db
    .select()
    .from(imports)
    .where(and(eq(imports.userId, userId), inArray(imports.status, ["pending", "processing"])))
    .limit(1);

  return active;
}

export async function findUserRecentImport(
  db: DrizzleDatabase,
  userId: User["id"],
  since: Date,
): Promise<Import | undefined> {
  const [recent] = await db
    .select()
    .from(imports)
    .where(and(eq(imports.userId, userId), gt(imports.createdAt, since)))
    .orderBy(desc(imports.createdAt))
    .limit(1);

  return recent;
}

export async function findLatestImportByUserId(
  db: DrizzleDatabase,
  userId: User["id"],
): Promise<Import | undefined> {
  const [latest] = await db
    .select()
    .from(imports)
    .where(eq(imports.userId, userId))
    .orderBy(desc(imports.createdAt))
    .limit(1);

  return latest;
}

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

export async function updateImport(
  db: DrizzleDatabase,
  id: Import["id"],
  values: UpdateImportValues,
): Promise<void> {
  await db
    .update(imports)
    .set({
      ...values,
      updatedAt: values.updatedAt ?? new Date(),
    })
    .where(eq(imports.id, id));
}

/**
 * Update an import only while it is active and its cursor is where the caller
 * read it. Cron runs can overlap, and a run that finishes late must not write
 * over the progress of a run that finished first. Returns whether the update
 * applied.
 */
export async function updateImportAtCursor(
  db: DrizzleDatabase,
  { id, cursor }: Pick<Import, "id" | "cursor">,
  values: UpdateImportValues,
): Promise<boolean> {
  const updated = await db
    .update(imports)
    .set({
      ...values,
      updatedAt: values.updatedAt ?? new Date(),
    })
    .where(
      and(
        eq(imports.id, id),
        eq(imports.cursor, cursor),
        inArray(imports.status, ["pending", "processing"]),
      ),
    )
    .returning({ id: imports.id });

  return updated.length > 0;
}
