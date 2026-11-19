import { env } from "cloudflare:workers";
import { describe, expect, test } from "vitest";

import type { WorkerEnv } from "../src/alchemy.ts";
import type { Database } from "../src/db/index.ts";
import type { GqlTrack } from "../src/import/graphql.ts";

import { createDatabase } from "../src/db/index.ts";
import { findActiveImportForCron, insertImport } from "../src/db/queries/imports.ts";
import {
  albums,
  artists,
  imports,
  scrobbles,
  trackArtists,
  tracks,
  users,
} from "../src/db/schema.ts";
import { getImportR2Key } from "../src/import/csv.ts";
import { INGESTION_EVENTS } from "../src/ingestion/events.ts";
import { runImportIngestion } from "../src/ingestion/import.ts";
import { createBatchWriteLimitDatabase, createStatementWriteLimitDatabase } from "./d1.ts";
import { captureLogs } from "./logs.ts";

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

/** Store a play of "Come Home" the way Spotify ingestion records one. */
async function seedRecordedPlay(db: Database, userId: string, playedAt: Date) {
  await db
    .insert(artists)
    .values({ spotifyUri: "spotify:artist:paak", name: "Anderson .Paak" })
    .onConflictDoNothing();

  await db
    .insert(tracks)
    .values({
      spotifyUri: "spotify:track:come-home",
      name: "Come Home",
      releaseDate: "2019",
      imageUrl: "https://example.com/ventura.jpg",
    })
    .onConflictDoNothing();

  await db
    .insert(trackArtists)
    .values({
      trackSpotifyUri: "spotify:track:come-home",
      artistSpotifyUri: "spotify:artist:paak",
      position: 0,
    })
    .onConflictDoNothing();

  await db.insert(scrobbles).values({
    id: `recorded-${playedAt.getTime()}`,
    userId,
    trackSpotifyUri: "spotify:track:come-home",
    scrobbleDate: playedAt,
  });
}

function throwingFetchBatch() {
  return async () => {
    throw new Error("metadata endpoint unavailable");
  };
}

describe("import ingestion cron processor", () => {
  test("returns idle when no active import exists", async () => {
    const result = await runImportIngestion(env);

    expect(result.status).toBe("idle");
    expect(result.processed).toBe(0);
  });

  test("marks import failed when R2 object is missing", async () => {
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

  test("keeps the album name from the file on a play that stays unresolved", async () => {
    const db = createDatabase(env.DB);

    await seedImport(env, db, {
      id: "import-unresolved",
      userId: "user-unresolved",
      username: "user_unresolved",
      createdAt: new Date(),
    });

    const result = await runImportIngestion(env, {
      batchLimit: 500,
      throttleMs: 0,
      fetchBatch: async () => ({ q0: null, q1: null }) satisfies Record<string, GqlTrack | null>,
    });

    expect(result.status).toBe("completed");

    const stored = await db.select().from(scrobbles);

    expect(stored.map((scrobble) => scrobble.albumName).sort()).toEqual(["EVERYTHING", "Ventura"]);
  });

  test("skips a row that ingestion recorded from Spotify minutes apart", async () => {
    const db = createDatabase(env.DB);

    await seedImport(env, db, {
      id: "import-overlapping",
      userId: "user-overlapping",
      username: "user_overlapping",
      createdAt: new Date(),
    });

    // The file stamps the start of the play; the recorded play is later by
    // about the track's length.
    await seedRecordedPlay(db, "user-overlapping", new Date(1644436588000 + 210_000));

    const result = await runImportIngestion(env, {
      batchLimit: 500,
      throttleMs: 0,
      fetchBatch: async () => ({ q0: null }) satisfies Record<string, GqlTrack | null>,
    });

    expect(result).toMatchObject({ status: "completed", processed: 1, skipped: 1 });

    const stored = await db.select().from(scrobbles);

    expect(stored.map((scrobble) => scrobble.trackName).sort()).toEqual(["Summerhouse", null]);

    const [row] = await db.select().from(imports);

    expect(row?.processedRows).toBe(1);
    expect(row?.skippedRows).toBe(1);
  });

  test("skips one row per recorded play when a track is on repeat", async () => {
    const db = createDatabase(env.DB);

    await seedImport(env, db, {
      id: "import-repeat",
      userId: "user-repeat",
      username: "user_repeat",
      createdAt: new Date(),
    });

    await env.IMPORTS_BUCKET.put(
      getImportR2Key("import-repeat"),
      "Artist;Album;Track;Date#user\n" +
        "Anderson .Paak;Ventura;Come Home;1644436588000\n" +
        "Anderson .Paak;Ventura;Come Home;1644436738000\n" +
        "Anderson .Paak;Ventura;Come Home;1644436888000",
    );

    await seedRecordedPlay(db, "user-repeat", new Date(1644436588000 + 210_000));

    const result = await runImportIngestion(env, {
      batchLimit: 500,
      throttleMs: 0,
      fetchBatch: async () => ({ q0: null }) satisfies Record<string, GqlTrack | null>,
    });

    expect(result).toMatchObject({ status: "completed", processed: 2, skipped: 1 });
    expect(await db.select().from(scrobbles)).toHaveLength(3);
  });

  test("matches each row to its nearest recorded play", async () => {
    const db = createDatabase(env.DB);
    const firstStart = 1644436588000;
    const secondStart = firstStart + 8 * 60_000;

    await seedImport(env, db, {
      id: "import-nearest",
      userId: "user-nearest",
      username: "user_nearest",
      createdAt: new Date(),
    });

    await env.IMPORTS_BUCKET.put(
      getImportR2Key("import-nearest"),
      "Artist;Album;Track;Date#user\n" +
        `Anderson .Paak;Ventura;Come Home;${secondStart}\n` +
        `Anderson .Paak;Ventura;Come Home;${firstStart}`,
    );

    await seedRecordedPlay(db, "user-nearest", new Date(firstStart + 3 * 60_000));
    await seedRecordedPlay(db, "user-nearest", new Date(secondStart + 3 * 60_000));

    const result = await runImportIngestion(env, {
      batchLimit: 500,
      throttleMs: 0,
      fetchBatch: async () => ({ q0: null }) satisfies Record<string, GqlTrack | null>,
    });

    expect(result).toMatchObject({ status: "completed", processed: 0, skipped: 2 });
    expect(await db.select().from(scrobbles)).toHaveLength(2);
  });

  test("imports a row whose track was recorded at another time", async () => {
    const db = createDatabase(env.DB);

    await seedImport(env, db, {
      id: "import-replayed",
      userId: "user-replayed",
      username: "user_replayed",
      createdAt: new Date(),
    });

    await seedRecordedPlay(db, "user-replayed", new Date(1644436588000 - 24 * 60 * 60 * 1000));

    const result = await runImportIngestion(env, {
      batchLimit: 500,
      throttleMs: 0,
      fetchBatch: async () => ({ q0: null, q1: null }) satisfies Record<string, GqlTrack | null>,
    });

    expect(result).toMatchObject({ status: "completed", processed: 2, skipped: 0 });
    expect(await db.select().from(scrobbles)).toHaveLength(3);
  });

  test("keeps the import processing with an unmoved cursor when a metadata batch fails", async () => {
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

  test("a run that finishes late does not write over a newer run's progress", async () => {
    const db = createDatabase(env.DB);

    await seedImport(env, db, {
      id: "import-overlap",
      userId: "user-overlap",
      username: "user_overlap",
      createdAt: new Date(),
    });

    const noMatch = async () => ({ q0: null }) satisfies Record<string, GqlTrack | null>;
    let overlapped = false;

    // The first run is still waiting on its lookup when two later runs start
    // from the same cursor and finish the import.
    const slowBatch = async () => {
      if (!overlapped) {
        overlapped = true;

        await runImportIngestion(env, { batchLimit: 1, throttleMs: 0, fetchBatch: noMatch });
        await runImportIngestion(env, { batchLimit: 1, throttleMs: 0, fetchBatch: noMatch });
      }

      return noMatch();
    };

    const late = await runImportIngestion(env, {
      batchLimit: 1,
      throttleMs: 0,
      fetchBatch: slowBatch,
    });

    expect(late).toEqual({ status: "superseded", processed: 0 });

    const [row] = await db.select().from(imports);

    expect(row?.status).toBe("completed");
    expect(row?.cursor).toBe(3);
    expect(row?.processedRows).toBe(2);
    expect(await db.select().from(scrobbles)).toHaveLength(2);

    const next = await runImportIngestion(env, {
      batchLimit: 1,
      throttleMs: 0,
      fetchBatch: noMatch,
    });

    expect(next.status).toBe("idle");
  });

  test("pauses without bookkeeping when D1 rejects the batch with its daily limit", async () => {
    const limited = { ...env, DB: createBatchWriteLimitDatabase(env.DB) };
    const db = createDatabase(env.DB);
    const logs = captureLogs();

    await seedImport(env, db, {
      id: "import-paused",
      userId: "user-paused",
      username: "user_paused",
      createdAt: new Date(),
    });

    try {
      const result = await runImportIngestion(limited, {
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
    const limited = { ...env, DB: createBatchWriteLimitDatabase(env.DB) };
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
        const result = await runImportIngestion(limited, {
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
    const limited = { ...env, DB: createStatementWriteLimitDatabase(env.DB) };
    const db = createDatabase(env.DB);
    const logs = captureLogs();

    await seedImport(env, db, {
      id: "import-first-write",
      userId: "user-first-write",
      username: "user_first_write",
      createdAt: new Date(),
    });

    try {
      const result = await runImportIngestion(limited, {
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
    expect(await env.IMPORTS_BUCKET.get(getImportR2Key("import-first-write"))).not.toBeNull();
    expect(logs.messages).toEqual([[INGESTION_EVENTS.d1WriteLimit]]);
  });

  test("logs the batch failure detail with its cause chain", async () => {
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
