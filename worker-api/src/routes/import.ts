import { Hono } from "hono";

import type { AppEnv } from "../types.ts";

import { requireSession, sessionMiddleware } from "../auth-middleware.ts";
import { createDatabase } from "../db/index.ts";
import { findLatestImportByUserId } from "../db/queries/imports.ts";
import { MAX_FILE_SIZE_BYTES } from "../import/csv.ts";
import { acceptImportUpload, checkImportUploadEligibility } from "../import/run.ts";

export default new Hono<AppEnv>()
  .use("/*", sessionMiddleware)
  .use("/*", requireSession)
  .get("/latest", async (c) => {
    const user = c.get("user");

    if (!user) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    const latest = await findLatestImportByUserId(createDatabase(c.env.DB), user.id);

    return c.json({ import: latest ?? null }, 200);
  })
  .post("/", async (c) => {
    const user = c.get("user");

    if (!user) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    const db = createDatabase(c.env.DB);

    // Checked before the body is read, so a rejected retry never pays the
    // multipart parse of a 10 MB upload.
    const ineligible = await checkImportUploadEligibility(db, user.id);

    if (ineligible) {
      return c.json({ error: ineligible.error }, ineligible.status);
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

    const result = await acceptImportUpload(c.env.IMPORTS_BUCKET, db, user.id, {
      filename: file.name,
      text,
      bytes: buffer,
    });

    if ("error" in result) {
      return c.json({ error: result.error }, result.status);
    }

    return c.json(result.data, 202);
  });
