import { describe, expect, test } from "bun:test";

import type { GqlTrack } from "../src/import/graphql.ts";

import { createDatabase } from "../src/db/index.ts";
import { insertImport } from "../src/db/queries/imports.ts";
import { albums, artists, imports, scrobbles, tracks, users } from "../src/db/schema.ts";
import { runImportIngestion } from "../src/ingestion/import.ts";
import { createTestEnv } from "./harness.ts";

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
      r2Key: "imports/does-not-exist.csv",
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
      r2Key,
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
      const response: Record<string, GqlTrack | null> = {};

      if (query.includes("Come Home")) {
        response.q0 = mockDb.matched;
      }

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
});
