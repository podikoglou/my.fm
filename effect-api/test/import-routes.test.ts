import { env } from "cloudflare:workers";
import { Effect, Layer } from "effect";
import { describe, expect, test } from "vitest";

import { findLatestImportByUserId, insertImport } from "../src/db/queries/imports.ts";
import { imports } from "../src/db/schema.ts";
import { createDatabase, Db } from "../src/db/service.ts";
import { getImportR2Key } from "../src/import/csv.ts";
import { Imports } from "../src/import/service.ts";
import { ImportsStorage } from "../src/storage/service.ts";
import worker, { type WorkerBindings } from "../src/worker.ts";
import { createFailingInsertDatabase, D1_WRITE_LIMIT_MESSAGE } from "./d1.ts";
import { baseUrl, signIn } from "./session.ts";

function csvForm(content: string, filename = "scrobbles.csv"): FormData {
  const form = new FormData();

  form.append("file", new File([content], filename, { type: "text/csv" }));

  return form;
}

const VALID_CSV =
  "Artist;Album;Track;Date#user\n" +
  "Anderson .Paak;Ventura;Come Home;1644436588000\n" +
  "KOTA The Friend;EVERYTHING;Summerhouse;1644437031000";

function runImportTickWithEnv(
  targetEnv: WorkerBindings,
  options?: Parameters<Imports["Service"]["runTick"]>[0],
) {
  const layer = Imports.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        Db.layerFromBinding(targetEnv.DB),
        ImportsStorage.layerFromBinding(targetEnv.IMPORTS_BUCKET),
      ),
    ),
  );

  return Effect.runPromise(
    Effect.gen(function* () {
      const svc = yield* Imports;

      return yield* svc.runTick(options);
    }).pipe(Effect.provide(layer)),
  );
}

describe("CSV import HTTP routes", () => {
  test("rejects CSV missing required columns with 422", async () => {
    const { cookie } = await signIn({ id: "sp-imp-1", email: "imp1@example.com" });

    const res = await worker.fetch(
      new Request(`${baseUrl}/api/import`, {
        method: "POST",
        headers: { cookie },
        body: csvForm("Artist;Album\nOnly;Two"),
      }),
      env,
    );

    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({
      error: expect.stringContaining("missing required columns"),
    });
  });

  test("rejects CSV with zero valid rows with 422", async () => {
    const { cookie } = await signIn({ id: "sp-imp-2", email: "imp2@example.com" });

    const res = await worker.fetch(
      new Request(`${baseUrl}/api/import`, {
        method: "POST",
        headers: { cookie },
        body: csvForm("Artist;Album;Track;Date#user\n;Album;;not-a-date"),
      }),
      env,
    );

    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({
      error: expect.stringContaining("no valid rows"),
    });
  });

  test("accepts a valid CSV upload with 202, persists to R2 and D1, and serves GET /api/import/latest", async () => {
    const { cookie, userId } = await signIn({ id: "sp-imp-3", email: "imp3@example.com" });

    const res = await worker.fetch(
      new Request(`${baseUrl}/api/import`, {
        method: "POST",
        headers: { cookie },
        body: csvForm(VALID_CSV, "history.csv"),
      }),
      env,
    );

    expect(res.status).toBe(202);

    const body = await res.json<{
      id: string;
      filename: string;
      status: string;
      totalLines: number;
    }>();

    expect(body.status).toBe("pending");
    expect(body.filename).toBe("history.csv");
    expect(body.totalLines).toBe(3);

    const r2Object = await env.IMPORTS_BUCKET.get(getImportR2Key(body.id));

    expect(r2Object).not.toBeNull();
    expect(await r2Object?.text()).toBe(VALID_CSV);

    const db = createDatabase(env.DB);
    const stored = await findLatestImportByUserId(db, userId);

    expect(stored?.id).toBe(body.id);
    expect(stored?.cursor).toBe(0);
    expect(stored?.status).toBe("pending");

    const latestRes = await worker.fetch(
      new Request(`${baseUrl}/api/import/latest`, {
        headers: { cookie },
      }),
      env,
    );

    expect(latestRes.status).toBe(200);

    const latestBody = await latestRes.json<{
      import: { id: string; status: string } | null;
    }>();

    expect(latestBody.import?.id).toBe(body.id);
    expect(latestBody.import?.status).toBe("pending");
  });

  test("returns 409 when a second upload arrives while one is pending", async () => {
    const { cookie } = await signIn({ id: "sp-imp-4", email: "imp4@example.com" });

    const first = await worker.fetch(
      new Request(`${baseUrl}/api/import`, {
        method: "POST",
        headers: { cookie },
        body: csvForm(VALID_CSV),
      }),
      env,
    );

    expect(first.status).toBe(202);

    const second = await worker.fetch(
      new Request(`${baseUrl}/api/import`, {
        method: "POST",
        headers: { cookie },
        body: csvForm(VALID_CSV),
      }),
      env,
    );

    expect(second.status).toBe(409);
  });

  test("returns 429 when uploading within one hour of a prior completed import", async () => {
    const { cookie, userId } = await signIn({ id: "sp-imp-5", email: "imp5@example.com" });
    const db = createDatabase(env.DB);

    await insertImport(db, {
      id: "prior-completed",
      userId,
      filename: "old.csv",
      status: "completed",
      cursor: 3,
      totalLines: 3,
      processedRows: 2,
      skippedRows: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const res = await worker.fetch(
      new Request(`${baseUrl}/api/import`, {
        method: "POST",
        headers: { cookie },
        body: csvForm(VALID_CSV),
      }),
      env,
    );

    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({
      error: expect.stringContaining("1 import per hour"),
    });
  });

  test("handles concurrent uploads by accepting one (202) and rejecting the other (409)", async () => {
    const { cookie } = await signIn({ id: "sp-imp-6", email: "imp6@example.com" });

    const [res1, res2] = await Promise.all([
      worker.fetch(
        new Request(`${baseUrl}/api/import`, {
          method: "POST",
          headers: { cookie },
          body: csvForm(VALID_CSV, "a.csv"),
        }),
        env,
      ),
      worker.fetch(
        new Request(`${baseUrl}/api/import`, {
          method: "POST",
          headers: { cookie },
          body: csvForm(VALID_CSV, "b.csv"),
        }),
        env,
      ),
    ]);

    expect([res1.status, res2.status].sort((a, b) => a - b)).toEqual([202, 409]);

    const db = createDatabase(env.DB);
    const rows = await db.select().from(imports);

    expect(rows).toHaveLength(1);

    const listed = await env.IMPORTS_BUCKET.list({ prefix: "imports/" });

    expect(listed.objects).toHaveLength(1);
  });

  test("returns 503 and cleans up R2 when D1 rejects the insert with a daily limit", async () => {
    const { cookie } = await signIn({ id: "sp-imp-7", email: "imp7@example.com" });

    const limitedEnv: WorkerBindings = {
      ...env,
      DB: createFailingInsertDatabase("imports", D1_WRITE_LIMIT_MESSAGE, env.DB),
    };

    const res = await worker.fetch(
      new Request(`${baseUrl}/api/import`, {
        method: "POST",
        headers: { cookie },
        body: csvForm(VALID_CSV),
      }),
      limitedEnv,
    );

    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({
      error: "Service is temporarily unavailable. Please try again tomorrow.",
    });

    const listed = await env.IMPORTS_BUCKET.list({ prefix: "imports/" });

    expect(listed.objects).toHaveLength(0);
  });

  test("returns generic 500 and cleans up R2 on internal D1 insert errors", async () => {
    const { cookie } = await signIn({ id: "sp-imp-8", email: "imp8@example.com" });

    const brokenEnv: WorkerBindings = {
      ...env,
      DB: createFailingInsertDatabase("imports", "internal sqlite constraint xyz", env.DB),
    };

    const res = await worker.fetch(
      new Request(`${baseUrl}/api/import`, {
        method: "POST",
        headers: { cookie },
        body: csvForm(VALID_CSV),
      }),
      brokenEnv,
    );

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({
      error: "Something went wrong. Please try again.",
    });

    const listed = await env.IMPORTS_BUCKET.list({ prefix: "imports/" });

    expect(listed.objects).toHaveLength(0);
  });

  test("reports failed status via GET /api/import/latest after three metadata failures", async () => {
    const { cookie } = await signIn({ id: "sp-imp-9", email: "imp9@example.com" });

    const upload = await worker.fetch(
      new Request(`${baseUrl}/api/import`, {
        method: "POST",
        headers: { cookie },
        body: csvForm(VALID_CSV),
      }),
      env,
    );

    expect(upload.status).toBe(202);

    const failingFetch = async () => {
      throw new Error("metadata endpoint unavailable");
    };

    for (let i = 0; i < 3; i++) {
      await runImportTickWithEnv(env, {
        batchLimit: 500,
        throttleMs: 0,
        fetchBatch: failingFetch,
      });
    }

    const latestRes = await worker.fetch(
      new Request(`${baseUrl}/api/import/latest`, {
        headers: { cookie },
      }),
      env,
    );

    expect(latestRes.status).toBe(200);

    const latestBody = await latestRes.json<{
      import: { status: string; error: string | null } | null;
    }>();

    expect(latestBody.import?.status).toBe("failed");
    expect(latestBody.import?.error).toContain("repeated metadata batch errors");
  });
});
