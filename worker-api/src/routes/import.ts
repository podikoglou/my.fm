import { Hono } from "hono";

import type { Database } from "../db/index.ts";
import type { ImportInsert } from "../db/schema.ts";
import type { AppEnv } from "../types.ts";

import { requireSession, sessionMiddleware } from "../auth-middleware.ts";
import { createDatabase } from "../db/index.ts";
import {
  findLatestImportByUserId,
  findUserActiveImport,
  findUserRecentImport,
  insertImport,
} from "../db/queries/imports.ts";
import { getImportR2Key, MAX_FILE_SIZE_BYTES } from "../import/csv.ts";
import { hasValidRow, readImportFile } from "../import/file.ts";

const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 hour

const ACTIVE_IMPORT_ERROR = "An import is already in progress";

/**
 * Record an upload whose file is already in storage.
 *
 * The cron finds a file only through its row, so the file is removed again
 * when no row is recorded: the insert failed, or a concurrent upload from the
 * same user took the active slot first.
 */
async function recordUpload(bucket: R2Bucket, db: Database, values: ImportInsert) {
  try {
    const row = await insertImport(db, values);

    if (!row) {
      await bucket.delete(getImportR2Key(values.id));
    }

    return row;
  } catch (error) {
    await bucket.delete(getImportR2Key(values.id));

    throw error;
  }
}

export default new Hono<AppEnv>()
  .use("/*", sessionMiddleware)
  .use("/*", requireSession)
  .get("/latest", async (c) => {
    const user = c.get("user");

    if (!user) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    const db = createDatabase(c.env.DB);
    const latest = await findLatestImportByUserId(db, user.id);

    return c.json({ import: latest ?? null }, 200);
  })
  .post("/", async (c) => {
    const user = c.get("user");

    if (!user) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    const db = createDatabase(c.env.DB);

    const active = await findUserActiveImport(db, user.id);

    if (active) {
      return c.json({ error: ACTIVE_IMPORT_ERROR }, 409);
    }

    const oneHourAgo = new Date(Date.now() - RATE_LIMIT_WINDOW_MS);
    const recent = await findUserRecentImport(db, user.id, oneHourAgo);

    if (recent) {
      return c.json({ error: "Upload rate limit exceeded: 1 import per hour" }, 429);
    }

    const contentLength = c.req.header("content-length");

    if (contentLength && Number(contentLength) > MAX_FILE_SIZE_BYTES) {
      return c.json({ error: "File exceeds 10 MB limit" }, 413);
    }

    let body: Record<string, string | File>;

    try {
      body = await c.req.parseBody();
    } catch {
      return c.json({ error: "Invalid multipart body" }, 400);
    }

    const file = body["file"];

    if (!(file instanceof File)) {
      return c.json({ error: "Missing CSV file" }, 400);
    }

    if (file.size > MAX_FILE_SIZE_BYTES) {
      return c.json({ error: "File exceeds 10 MB limit" }, 413);
    }

    const buffer = await file.arrayBuffer();
    let text: string;

    try {
      const decoder = new TextDecoder("utf-8", { fatal: true });
      text = decoder.decode(buffer);
    } catch {
      return c.json({ error: "Invalid UTF-8 encoding" }, 422);
    }

    const read = readImportFile(text);

    if (!read.ok) {
      return c.json({ error: read.error }, 422);
    }

    if (!hasValidRow(read.file)) {
      return c.json({ error: "CSV file contains no valid rows" }, 422);
    }

    const id = crypto.randomUUID();
    const r2Key = getImportR2Key(id);

    await c.env.IMPORTS_BUCKET.put(r2Key, buffer, {
      httpMetadata: { contentType: "text/csv; charset=utf-8" },
    });

    const now = new Date();

    const row = await recordUpload(c.env.IMPORTS_BUCKET, db, {
      id,
      userId: user.id,
      filename: file.name || "listening-history.csv",
      status: "pending",
      cursor: 0,
      totalLines: read.file.lines.length,
      processedRows: 0,
      skippedRows: 0,
      createdAt: now,
      updatedAt: now,
    });

    if (!row) {
      return c.json({ error: ACTIVE_IMPORT_ERROR }, 409);
    }

    return c.json(
      {
        id: row.id,
        filename: row.filename,
        status: row.status,
        totalLines: row.totalLines,
      },
      202,
    );
  });
