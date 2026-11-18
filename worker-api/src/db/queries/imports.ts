import { and, desc, eq, gt, inArray } from "drizzle-orm";

import type { Database } from "../index.ts";
import type { Import, ImportInsert, User } from "../schema.ts";

import { imports } from "../schema.ts";

export async function insertImport(db: Database, values: ImportInsert): Promise<Import> {
  const [row] = await db.insert(imports).values(values).returning();

  if (!row) {
    throw new Error("Failed to insert import row");
  }

  return row;
}

export async function findActiveImportForCron(db: Database): Promise<Import | undefined> {
  const [active] = await db
    .select()
    .from(imports)
    .where(inArray(imports.status, ["pending", "processing"]))
    .orderBy(imports.createdAt)
    .limit(1);

  return active;
}

export async function findUserActiveImport(
  db: Database,
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
  db: Database,
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
  db: Database,
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
  status?: "pending" | "processing" | "completed" | "failed";
  cursor?: number;
  totalLines?: number;
  processedRows?: number;
  skippedRows?: number;
  error?: string | null;
  updatedAt?: Date;
};

export async function updateImport(
  db: Database,
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
