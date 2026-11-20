import { env } from "cloudflare:workers";
import { http } from "msw";
import { describe, expect, test } from "vitest";
import z from "zod";

import { createApp } from "../src/app.ts";
import { createDatabase } from "../src/db/index.ts";
import { imports } from "../src/db/schema.ts";
import { runImportIngestion } from "../src/ingestion/import.ts";
import { createFailingInsertDatabase, D1_WRITE_LIMIT_MESSAGE } from "./d1.ts";
import { network } from "./network.ts";

const baseUrl = "http://app.test";

async function signIn(spotify: { id: string; email: string }) {
  const app = createApp();

  network.use(
    http.all("https://*.spotify.com/*", ({ request }) => {
      const url = request.url;

      if (url.startsWith("https://accounts.spotify.com/api/token")) {
        return Response.json({
          access_token: "access-token",
          expires_in: 3600,
          refresh_token: "refresh-token",
          scope: "user-read-email",
          token_type: "Bearer",
        });
      }

      if (url.startsWith("https://api.spotify.com/v1/me")) {
        return Response.json({
          display_name: "Test User",
          email: spotify.email,
          id: spotify.id,
          images: [],
        });
      }

      throw new Error(`Unexpected fetch: ${url}`);
    }),
  );

  const signInResponse = await app.request(
    `${baseUrl}/api/auth/sign-in/social`,
    {
      method: "POST",
      headers: { "content-type": "application/json", origin: baseUrl },
      body: JSON.stringify({ provider: "spotify", callbackURL: `${baseUrl}/onboard` }),
    },
    env,
  );

  const { url } = z.object({ url: z.string() }).parse(await signInResponse.json());
  const state = new URL(url).searchParams.get("state");
  const cookies = signInResponse.headers.getSetCookie().map((cookie) => cookie.split(";")[0]);

  const callback = await app.request(
    `${baseUrl}/api/auth/callback/spotify?code=fake-code&state=${state}`,
    { headers: { cookie: cookies.join("; ") } },
    env,
  );

  expect(callback.status).toBe(302);

  const sessionCookies = callback.headers.getSetCookie().map((cookie) => cookie.split(";")[0]);

  const user = await createDatabase(env.DB).query.users.findFirst({
    where: { email: spotify.email },
  });

  if (!user) {
    throw new Error("The Spotify callback did not create a user");
  }

  return { cookie: sessionCookies.join("; "), userId: user.id };
}

describe("import routes", () => {
  test("rejects CSV with missing headers", async () => {
    const app = createApp();
    const { cookie } = await signIn({ id: "user-2", email: "user2@example.com" });

    const csvContent = "Something;Else;Wrong\n1;2;3";
    const file = new File([csvContent], "history.csv", { type: "text/csv" });
    const formData = new FormData();
    formData.append("file", file);

    const response = await app.request(
      `${baseUrl}/api/import`,
      {
        method: "POST",
        headers: { cookie },
        body: formData,
      },
      env,
    );

    expect(response.status).toBe(422);

    const body = z.object({ error: z.string() }).parse(await response.json());

    expect(body.error).toContain("missing required columns");
  });

  test("rejects CSV with 0 valid rows", async () => {
    const app = createApp();
    const { cookie } = await signIn({ id: "user-3", email: "user3@example.com" });

    const csvContent = "Artist;Album;Track;Date#user\n;;;invalid-date";
    const file = new File([csvContent], "history.csv", { type: "text/csv" });
    const formData = new FormData();
    formData.append("file", file);

    const response = await app.request(
      `${baseUrl}/api/import`,
      {
        method: "POST",
        headers: { cookie },
        body: formData,
      },
      env,
    );

    expect(response.status).toBe(422);

    const bodyEmpty = z.object({ error: z.string() }).parse(await response.json());

    expect(bodyEmpty.error).toContain("no valid rows");
  });

  test("accepts valid CSV, stores in R2, and creates pending import row", async () => {
    const app = createApp();
    const { cookie, userId } = await signIn({ id: "user-4", email: "user4@example.com" });

    const csvContent =
      "Artist;Album;Track;Date#user4\n" +
      "Anderson .Paak;Ventura;Come Home;1644436588000\n" +
      "KOTA The Friend;EVERYTHING;Summerhouse;1644437031000";

    const file = new File([csvContent], "export.csv", { type: "text/csv" });
    const formData = new FormData();
    formData.append("file", file);

    const response = await app.request(
      `${baseUrl}/api/import`,
      {
        method: "POST",
        headers: { cookie },
        body: formData,
      },
      env,
    );

    expect(response.status).toBe(202);

    const result = z
      .object({
        id: z.string(),
        filename: z.string(),
        status: z.string(),
        totalLines: z.number(),
      })
      .parse(await response.json());

    expect(result.status).toBe("pending");
    expect(result.filename).toBe("export.csv");
    expect(result.totalLines).toBe(3);

    // Check R2 storage
    const r2Key = `imports/${result.id}.csv`;
    const r2Obj = await env.IMPORTS_BUCKET.get(r2Key);

    expect(r2Obj).not.toBeNull();

    const storedText = await r2Obj?.text();

    expect(storedText).toBe(csvContent);

    // Check D1 database
    const db = createDatabase(env.DB);
    const [row] = await db.select().from(imports);

    expect(row).toBeDefined();
    expect(row?.id).toBe(result.id);
    expect(row?.userId).toBe(userId);
    expect(row?.cursor).toBe(0);
    expect(row?.status).toBe("pending");

    // Check GET /latest
    const latestResponse = await app.request(
      `${baseUrl}/api/import/latest`,
      { headers: { cookie } },
      env,
    );

    expect(latestResponse.status).toBe(200);

    const latestBody = z
      .object({
        import: z
          .object({
            id: z.string(),
            status: z.string(),
          })
          .nullable(),
      })
      .parse(await latestResponse.json());

    expect(latestBody.import?.id).toBe(result.id);
    expect(latestBody.import?.status).toBe("pending");
  });

  test("rejects upload when active import is already in flight", async () => {
    const app = createApp();
    const { cookie } = await signIn({ id: "user-5", email: "user5@example.com" });

    const csvContent =
      "Artist;Album;Track;Date#user5\n" + "Anderson .Paak;Ventura;Come Home;1644436588000";

    const file = new File([csvContent], "export.csv", { type: "text/csv" });
    const formData = new FormData();
    formData.append("file", file);

    const first = await app.request(
      `${baseUrl}/api/import`,
      {
        method: "POST",
        headers: { cookie },
        body: formData,
      },
      env,
    );

    expect(first.status).toBe(202);

    // Second upload while pending should return 409 Conflict
    const secondFormData = new FormData();
    secondFormData.append("file", file);

    const second = await app.request(
      `${baseUrl}/api/import`,
      {
        method: "POST",
        headers: { cookie },
        body: secondFormData,
      },
      env,
    );

    expect(second.status).toBe(409);
  });

  test("accepts one of two uploads that arrive together", async () => {
    const app = createApp();
    const { cookie } = await signIn({ id: "user-7", email: "user7@example.com" });

    const csvContent =
      "Artist;Album;Track;Date#user7\n" + "Anderson .Paak;Ventura;Come Home;1644436588000";

    const upload = () => {
      const formData = new FormData();
      formData.append("file", new File([csvContent], "export.csv", { type: "text/csv" }));

      return app.request(
        `${baseUrl}/api/import`,
        { method: "POST", headers: { cookie }, body: formData },
        env,
      );
    };

    const responses = await Promise.all([upload(), upload()]);

    expect(responses.map((response) => response.status)).toEqual(
      expect.arrayContaining([202, 409]),
    );
    expect(await createDatabase(env.DB).select().from(imports)).toHaveLength(1);

    const stored = await env.IMPORTS_BUCKET.list();

    expect(stored.objects).toHaveLength(1);
  });

  test("removes the stored file when the import row cannot be recorded", async () => {
    const app = createApp();
    const { cookie } = await signIn({ id: "user-8", email: "user8@example.com" });

    const csvContent =
      "Artist;Album;Track;Date#user8\n" + "Anderson .Paak;Ventura;Come Home;1644436588000";

    const formData = new FormData();
    formData.append("file", new File([csvContent], "export.csv", { type: "text/csv" }));

    const response = await app.request(
      `${baseUrl}/api/import`,
      { method: "POST", headers: { cookie }, body: formData },
      { ...env, DB: createFailingInsertDatabase("imports", D1_WRITE_LIMIT_MESSAGE, env.DB) },
    );

    expect(response.status).toBe(500);
    expect(await createDatabase(env.DB).select().from(imports)).toHaveLength(0);

    const stored = await env.IMPORTS_BUCKET.list();

    expect(stored.objects).toHaveLength(0);
  });

  test("reports failed status and error after repeated ingestion failures", async () => {
    const app = createApp();
    const { cookie } = await signIn({ id: "user-6", email: "user6@example.com" });

    const csvContent =
      "Artist;Album;Track;Date#user6\n" + "Anderson .Paak;Ventura;Come Home;1644436588000";

    const file = new File([csvContent], "export.csv", { type: "text/csv" });
    const formData = new FormData();
    formData.append("file", file);

    const upload = await app.request(
      `${baseUrl}/api/import`,
      {
        method: "POST",
        headers: { cookie },
        body: formData,
      },
      env,
    );

    expect(upload.status).toBe(202);

    const fetchBatch = async () => {
      throw new Error("metadata endpoint unavailable");
    };

    for (let i = 0; i < 3; i++) {
      await runImportIngestion(env, { batchLimit: 500, throttleMs: 0, fetchBatch });
    }

    const latestResponse = await app.request(
      `${baseUrl}/api/import/latest`,
      { headers: { cookie } },
      env,
    );

    expect(latestResponse.status).toBe(200);

    const latestBody = z
      .object({
        import: z
          .object({
            status: z.string(),
            error: z.string().nullable(),
          })
          .nullable(),
      })
      .parse(await latestResponse.json());

    expect(latestBody.import?.status).toBe("failed");
    expect(latestBody.import?.error).toContain("repeated metadata batch errors");
  });
});
