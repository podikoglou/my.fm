import { describe, expect, test } from "bun:test";

import type { WorkerEnv } from "../src/alchemy.ts";
import type { Database } from "../src/db/index.ts";
import type { GqlTrack } from "../src/import/graphql.ts";

import { createDatabase } from "../src/db/index.ts";
import { findActiveImportForCron, insertImport } from "../src/db/queries/imports.ts";
import { albums, artists, imports, scrobbles, tracks, users } from "../src/db/schema.ts";
import { getImportR2Key } from "../src/import/csv.ts";
import { INGESTION_EVENTS } from "../src/ingestion/events.ts";
import { runImportIngestion } from "../src/ingestion/import.ts";
import {
  captureLogs,
  createBatchWriteLimitDatabase,
  createStatementWriteLimitDatabase,
  createTestDatabase,
  createTestEnv,
  createTestR2Bucket,
} from "./harness.ts";

const FAILING_CSV =
  "Artist;Album;Track;Date#user\n" +
  "Anderson .Paak;Ventura;Come Home;1644436588000\n" +
  "KOTA The Friend;EVERYTHING;Summerhouse;1644437031000";

async function seedImport(
  env: WorkerEnv,
  db: Database,
  values: { id: string; userId: string; username: string; createdAt: Date },
) {
  await db.insert(users).values({
    id: values.userId,
    username: values.username,
    name: values.username,
    email: `${values.username}@example.com`,
  });

  await env.IMPORTS_BUCKET.put(getImportR2Key(values.id), FAILING_CSV);

  await insertImport(db, {
    id: values.id,
    userId: values.userId,
    filename: "export.csv",
    status: "pending",
    cursor: 0,
    totalLines: 3,
    processedRows: 0,
    skippedRows: 0,
    createdAt: values.createdAt,
    updatedAt: values.createdAt,
  });
}

function throwingFetchBatch() {
  return async () => {
    throw new Error("metadata endpoint unavailable");
  };
}

describe("import ingestion cron processor", () => {
  test("returns idle when no active import exists", async () => {
    const env = createTestEnv();
    const result = await runImportIngestion(env);

    expect(result.status).toBe("idle");
    expect(result.processed).toBe(0);
  });

  test("marks import failed when R2 object is missing", async () => {
    const env = createTestEnv();
    const db = createDatabase(env.DB);
    const userId = "user-missing-file";

    await db.insert(users).values({
      id: userId,
      username: "user_missing",
      name: "User Missing",
      email: "missing@example.com",
    });

    await insertImport(db, {
      id: "import-missing",
      userId,
      filename: "export.csv",
      status: "pending",
      cursor: 0,
      processedRows: 0,
      skippedRows: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const result = await runImportIngestion(env);

    expect(result.status).toBe("failed");

    const [row] = await db.select().from(imports);

    expect(row?.status).toBe("failed");
    expect(row?.error).toContain("File not found");
  });

  test("processes lines, resolves metadata, writes to D1 and deletes R2 on completion", async () => {
    const env = createTestEnv();
    const db = createDatabase(env.DB);
    const userId = "user-full-test";

    await db.insert(users).values({
      id: userId,
      username: "user_test",
      name: "User Test",
      email: "test@example.com",
    });

    const csvContent =
      "Artist;Album;Track;Date#user_test\n" +
      "Anderson .Paak;Ventura;Come Home;1644436588000\n" +
      "Unknown Singer;;Ghost Track;1644437000000";

    const r2Key = "imports/import-1.csv";
    await env.IMPORTS_BUCKET.put(r2Key, csvContent);

    await insertImport(db, {
      id: "import-1",
      userId,
      filename: "export.csv",
      status: "pending",
      cursor: 0,
      totalLines: 3,
      processedRows: 0,
      skippedRows: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const mockDb = {
      matched: {
        title: "Come Home",
        spotifyUrl: "https://open.spotify.com/track/spotify-track-1",
        coverArt: { front500: "https://coverartarchive.org/500.jpg" },
        artist: {
          name: "Anderson .Paak",
          spotifyUrl: "https://open.spotify.com/artist/spotify-artist-1",
        },
        album: {
          title: "Ventura",
          spotifyUrl: "https://open.spotify.com/album/spotify-album-1",
          releaseDate: "2019",
          type: "album",
        },
      },
    } satisfies Record<string, GqlTrack | null>;

    const mockFetch = async (_endpoint: string, query: string) => {
      const response = {
        q0: query.includes("Come Home") ? mockDb.matched : null,
        q1: null,
      } satisfies Record<string, GqlTrack | null>;

      return response;
    };

    const runResult = await runImportIngestion(env, {
      batchLimit: 500,
      throttleMs: 0,
      fetchBatch: mockFetch,
    });

    expect(runResult.status).toBe("completed");
    expect(runResult.processed).toBe(2);

    // Check imports table status
    const [importRow] = await db.select().from(imports);

    expect(importRow?.status).toBe("completed");
    expect(importRow?.processedRows).toBe(2);
    expect(importRow?.cursor).toBe(3);

    // R2 file should be deleted on completion
    const r2After = await env.IMPORTS_BUCKET.get(r2Key);

    expect(r2After).toBeNull();

    // Check canonical entities
    const storedArtists = await db.select().from(artists);

    expect(storedArtists).toHaveLength(1);
    expect(storedArtists[0]?.name).toBe("Anderson .Paak");
    expect(storedArtists[0]?.spotifyUri).toBe("spotify:artist:spotify-artist-1");

    const storedAlbums = await db.select().from(albums);

    expect(storedAlbums).toHaveLength(1);
    expect(storedAlbums[0]?.name).toBe("Ventura");
    expect(storedAlbums[0]?.spotifyUri).toBe("spotify:album:spotify-album-1");

    const storedTracks = await db.select().from(tracks);

    expect(storedTracks).toHaveLength(1);
    expect(storedTracks[0]?.name).toBe("Come Home");
    expect(storedTracks[0]?.spotifyUri).toBe("spotify:track:spotify-track-1");

    // Check scrobbles: exactly 2 plays inserted (1 linked, 1 unlinked fallback)
    const storedScrobbles = await db.select().from(scrobbles);

    expect(storedScrobbles).toHaveLength(2);

    const linked = storedScrobbles.find((s) => s.trackSpotifyUri !== null);
    const unlinked = storedScrobbles.find((s) => s.trackSpotifyUri === null);

    expect(linked).toBeDefined();
    expect(linked?.trackName).toBe("Come Home");
    expect(linked?.trackSpotifyUri).toBe("spotify:track:spotify-track-1");
    expect(linked?.coverArtUrl).toBe("https://coverartarchive.org/500.jpg");

    expect(unlinked).toBeDefined();
    expect(unlinked?.trackName).toBe("Ghost Track");
    expect(unlinked?.artistName).toBe("Unknown Singer");
    expect(unlinked?.trackSpotifyUri).toBeNull();
  });

  test("handles track with album Spotify URI but missing track Spotify URI without foreign key failure", async () => {
    const env = createTestEnv();
    const db = createDatabase(env.DB);
    const userId = "user-partial-match";

    await db.insert(users).values({
      id: userId,
      username: "user_partial",
      name: "User Partial",
      email: "partial@example.com",
    });

    const csvContent =
      "Artist;Album;Track;Date#user_partial\n" +
      "IDK;IDK & FRIENDS :);ONCE UPON A TIME (FREESTYLE);1644472883000";

    const r2Key = "imports/import-partial.csv";
    await env.IMPORTS_BUCKET.put(r2Key, csvContent);

    await insertImport(db, {
      id: "import-partial",
      userId,
      filename: "partial.csv",
      status: "pending",
      cursor: 0,
      totalLines: 2,
      processedRows: 0,
      skippedRows: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const mockFetch = async () => ({
      q0: {
        title: "ONCE UPON A TIME (FREESTYLE)",
        spotifyUrl: null, // No track URL
        album: {
          title: "IDK & FRIENDS :)",
          spotifyUrl: "https://open.spotify.com/album/spotify-album-partial-1",
          releaseDate: "2018",
          type: "album",
        },
        artist: {
          name: "IDK",
          spotifyUrl: "https://open.spotify.com/artist/spotify-artist-partial-1",
        },
      },
    });

    const runResult = await runImportIngestion(env, {
      batchLimit: 500,
      throttleMs: 0,
      fetchBatch: mockFetch,
    });

    expect(runResult.status).toBe("completed");
    expect(runResult.processed).toBe(1);

    const storedScrobbles = await db.select().from(scrobbles);
    expect(storedScrobbles).toHaveLength(1);
    expect(storedScrobbles[0]?.trackName).toBe("ONCE UPON A TIME (FREESTYLE)");
    expect(storedScrobbles[0]?.albumName).toBe("IDK & FRIENDS :)");
    expect(storedScrobbles[0]?.trackSpotifyUri).toBeNull();
    expect(storedScrobbles[0]?.albumSpotifyUri).toBeNull();
  });

  test("keeps the import processing with an unmoved cursor when a metadata batch fails", async () => {
    const env = createTestEnv();
    const db = createDatabase(env.DB);

    await seedImport(env, db, {
      id: "import-flaky",
      userId: "user-flaky",
      username: "user_flaky",
      createdAt: new Date(),
    });

    const fetchBatch = throwingFetchBatch();

    await runImportIngestion(env, { batchLimit: 500, throttleMs: 0, fetchBatch });
    await runImportIngestion(env, { batchLimit: 500, throttleMs: 0, fetchBatch });

    const [row] = await db.select().from(imports);

    expect(row?.status).toBe("processing");
    expect(row?.cursor).toBe(0);
    expect(row?.processedRows).toBe(0);
    expect(row?.attemptCount).toBe(2);
  });

  test("marks the import failed after three consecutive batch failures", async () => {
    const env = createTestEnv();
    const db = createDatabase(env.DB);

    await seedImport(env, db, {
      id: "import-doomed",
      userId: "user-doomed",
      username: "user_doomed",
      createdAt: new Date(),
    });

    const fetchBatch = throwingFetchBatch();

    for (let i = 0; i < 3; i++) {
      await runImportIngestion(env, { batchLimit: 500, throttleMs: 0, fetchBatch });
    }

    const [row] = await db.select().from(imports);

    expect(row?.status).toBe("failed");
    expect(row?.error).toContain("repeated metadata batch errors");
    expect(row?.cursor).toBe(0);

    const active = await findActiveImportForCron(db);

    expect(active).toBeUndefined();

    // A failed import is terminal, so its file must not linger in storage.
    const r2After = await env.IMPORTS_BUCKET.get(getImportR2Key("import-doomed"));

    expect(r2After).toBeNull();
  });

  test("resets the failure counter after a successful run", async () => {
    const env = createTestEnv();
    const db = createDatabase(env.DB);

    await seedImport(env, db, {
      id: "import-recovered",
      userId: "user-recovered",
      username: "user_recovered",
      createdAt: new Date(),
    });

    let failing = true;

    const fetchBatch = async () => {
      if (failing) {
        throw new Error("metadata endpoint unavailable");
      }

      return { q0: null, q1: null } satisfies Record<string, GqlTrack | null>;
    };

    await runImportIngestion(env, { batchLimit: 500, throttleMs: 0, fetchBatch });

    failing = false;

    const result = await runImportIngestion(env, { batchLimit: 500, throttleMs: 0, fetchBatch });

    expect(result.status).toBe("completed");
    expect(result.processed).toBe(2);

    const [row] = await db.select().from(imports);

    expect(row?.status).toBe("completed");
    expect(row?.cursor).toBe(3);
    expect(row?.attemptCount).toBe(0);
  });

  test("a permanently failing import does not block another user's import", async () => {
    const env = createTestEnv();
    const db = createDatabase(env.DB);

    await seedImport(env, db, {
      id: "import-stuck",
      userId: "user-stuck",
      username: "user_stuck",
      createdAt: new Date("2026-11-17T00:00:00Z"),
    });

    await seedImport(env, db, {
      id: "import-next",
      userId: "user-next",
      username: "user_next",
      createdAt: new Date("2026-11-18T00:00:00Z"),
    });

    const failingBatch = throwingFetchBatch();

    for (let i = 0; i < 3; i++) {
      await runImportIngestion(env, { batchLimit: 500, throttleMs: 0, fetchBatch: failingBatch });
    }

    // The oldest import gave up, so the cron queue must now hold the next one.
    const active = await findActiveImportForCron(db);

    expect(active?.id).toBe("import-next");

    const result = await runImportIngestion(env, {
      batchLimit: 500,
      throttleMs: 0,
      fetchBatch: async () => ({ q0: null, q1: null }) satisfies Record<string, GqlTrack | null>,
    });

    expect(result.status).toBe("completed");

    const rows = await db.select().from(imports);
    const stuck = rows.find((row) => row.id === "import-stuck");
    const next = rows.find((row) => row.id === "import-next");

    expect(stuck?.status).toBe("failed");
    expect(next?.status).toBe("completed");
    expect(next?.processedRows).toBe(2);
  });

  test("pauses without bookkeeping when D1 rejects the batch with its daily limit", async () => {
    const env = createTestEnv(createBatchWriteLimitDatabase());
    const db = createDatabase(env.DB);
    const logs = captureLogs();

    await seedImport(env, db, {
      id: "import-paused",
      userId: "user-paused",
      username: "user_paused",
      createdAt: new Date(),
    });

    try {
      const result = await runImportIngestion(env, {
        batchLimit: 500,
        throttleMs: 0,
        fetchBatch: async () => ({ q0: null, q1: null }) satisfies Record<string, GqlTrack | null>,
      });

      expect(result).toEqual({ status: "paused", processed: 0 });
    } finally {
      logs.restore();
    }

    const [row] = await db.select().from(imports);

    // The pre-failure transition persisted; the pause changed nothing else.
    expect(row?.status).toBe("processing");
    expect(row?.attemptCount).toBe(0);
    expect(row?.cursor).toBe(0);

    expect(await env.IMPORTS_BUCKET.get(getImportR2Key("import-paused"))).not.toBeNull();
    expect(logs.messages).toEqual([[INGESTION_EVENTS.d1WriteLimit]]);
    expect(logs.named(INGESTION_EVENTS.importIngested)).toEqual([]);
  });

  test("does not abandon the import across repeated quota pauses", async () => {
    const env = createTestEnv(createBatchWriteLimitDatabase());
    const db = createDatabase(env.DB);
    const logs = captureLogs();

    await seedImport(env, db, {
      id: "import-paused",
      userId: "user-paused",
      username: "user_paused",
      createdAt: new Date(),
    });

    const fetchBatch = async () =>
      ({ q0: null, q1: null }) satisfies Record<string, GqlTrack | null>;

    try {
      for (let i = 0; i < 3; i++) {
        const result = await runImportIngestion(env, {
          batchLimit: 500,
          throttleMs: 0,
          fetchBatch,
        });

        expect(result).toEqual({ status: "paused", processed: 0 });
      }
    } finally {
      logs.restore();
    }

    const [row] = await db.select().from(imports);

    expect(row?.status).toBe("processing");
    expect(row?.attemptCount).toBe(0);

    const active = await findActiveImportForCron(db);

    expect(active?.id).toBe("import-paused");
    expect(await env.IMPORTS_BUCKET.get(getImportR2Key("import-paused"))).not.toBeNull();
    expect(logs.messages).toHaveLength(3);
  });

  test("pauses when the first status write is the failure", async () => {
    const base = createTestDatabase();
    const bucket = createTestR2Bucket();
    const db = createDatabase(base);
    const logs = captureLogs();

    await seedImport(createTestEnv(base, bucket), db, {
      id: "import-first-write",
      userId: "user-first-write",
      username: "user_first_write",
      createdAt: new Date(),
    });

    const env = createTestEnv(createStatementWriteLimitDatabase(base), bucket);

    try {
      const result = await runImportIngestion(env, {
        batchLimit: 500,
        throttleMs: 0,
        fetchBatch: async () => ({ q0: null, q1: null }) satisfies Record<string, GqlTrack | null>,
      });

      expect(result).toEqual({ status: "paused", processed: 0 });
    } finally {
      logs.restore();
    }

    const [row] = await db.select().from(imports);

    expect(row?.status).toBe("pending");
    expect(row?.attemptCount).toBe(0);
    expect(await bucket.get(getImportR2Key("import-first-write"))).not.toBeNull();
    expect(logs.messages).toEqual([[INGESTION_EVENTS.d1WriteLimit]]);
  });

  test("logs the batch failure detail with its cause chain", async () => {
    const env = createTestEnv();
    const db = createDatabase(env.DB);
    const logs = captureLogs();

    await seedImport(env, db, {
      id: "import-detail",
      userId: "user-detail",
      username: "user_detail",
      createdAt: new Date(),
    });

    try {
      await runImportIngestion(env, {
        batchLimit: 500,
        throttleMs: 0,
        fetchBatch: throwingFetchBatch(),
      });
    } finally {
      logs.restore();
    }

    expect(logs.messages).toContainEqual([
      INGESTION_EVENTS.importBatchFailed,
      { name: "Error", message: "metadata endpoint unavailable", causes: [] },
    ]);

    const [row] = await db.select().from(imports);

    expect(row?.attemptCount).toBe(1);
  });
});
