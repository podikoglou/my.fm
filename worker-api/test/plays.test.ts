import { env } from "cloudflare:workers";
import { describe, expect, test, vi } from "vitest";

import { createDatabase } from "../src/db/index.ts";
import { buildPlayStatements, persistPlays, type PlayRecord } from "../src/db/queries/plays.ts";
import {
  albumArtists,
  albums,
  artists,
  scrobbles,
  trackArtists,
  tracks,
  users,
} from "../src/db/schema.ts";

const now = new Date("2026-11-20T12:00:00.000Z");

async function seedUser(userId = "user-1") {
  const db = createDatabase(env.DB);

  await db.insert(users).values({
    id: userId,
    username: `user-${userId}`,
    name: "Test User",
    email: `${userId}@example.com`,
    updatedAt: now,
  });
}

describe("persistPlays", () => {
  test("persists catalog entities and scrobble in dependency order", async () => {
    const db = createDatabase(env.DB);
    await seedUser("user-1");

    const play: PlayRecord = {
      id: "scrobble-1",
      userId: "user-1",
      scrobbleDate: now,
      track: {
        spotifyUri: "spotify:track:1",
        name: "Test Track",
        trackNumber: 1,
        releaseDate: "2026",
        imageUrl: "https://example.com/track.jpg",
        explicit: false,
        duration: 200_000,
        artists: [
          { spotifyUri: "spotify:artist:1", name: "Primary Artist" },
          { spotifyUri: "spotify:artist:2", name: "Featured Artist" },
        ],
      },
      album: {
        spotifyUri: "spotify:album:1",
        name: "Test Album",
        releaseDate: "2026",
        totalTracks: 10,
        albumType: "album",
        imageUrl: "https://example.com/album.jpg",
        artists: [
          { spotifyUri: "spotify:artist:1", name: "Primary Artist" },
          { spotifyUri: "spotify:artist:3", name: "Producer Artist" },
        ],
      },
    };

    await persistPlays(db, [play]);

    const storedArtists = await db.select().from(artists).orderBy(artists.spotifyUri);
    expect(storedArtists.map((a) => a.name)).toEqual([
      "Primary Artist",
      "Featured Artist",
      "Producer Artist",
    ]);

    const [album] = await db.select().from(albums);
    expect(album).toMatchObject({
      spotifyUri: "spotify:album:1",
      name: "Test Album",
      releaseDate: "2026",
      totalTracks: 10,
      albumType: "album",
      imageUrl: "https://example.com/album.jpg",
    });

    const [track] = await db.select().from(tracks);
    expect(track).toMatchObject({
      spotifyUri: "spotify:track:1",
      name: "Test Track",
      trackNumber: 1,
      duration: 200_000,
    });

    const storedTrackArtists = await db.select().from(trackArtists).orderBy(trackArtists.position);
    expect(
      storedTrackArtists.map(({ artistSpotifyUri, position }) => [artistSpotifyUri, position]),
    ).toEqual([
      ["spotify:artist:1", 0],
      ["spotify:artist:2", 1],
    ]);

    const storedAlbumArtists = await db.select().from(albumArtists).orderBy(albumArtists.position);
    expect(
      storedAlbumArtists.map(({ artistSpotifyUri, position }) => [artistSpotifyUri, position]),
    ).toEqual([
      ["spotify:artist:1", 0],
      ["spotify:artist:3", 1],
    ]);

    const [scrobble] = await db.select().from(scrobbles);
    expect(scrobble).toMatchObject({
      id: "scrobble-1",
      userId: "user-1",
      trackSpotifyUri: "spotify:track:1",
      albumSpotifyUri: "spotify:album:1",
      scrobbleDate: now,
    });
  });

  test("persists an unresolved play without catalog entities", async () => {
    const db = createDatabase(env.DB);
    await seedUser("user-2");

    const play: PlayRecord = {
      id: "scrobble-unresolved",
      userId: "user-2",
      scrobbleDate: now,
      artistName: "Unknown Artist",
      albumName: "Unknown Album",
      trackName: "Unknown Track",
      coverArtUrl: "https://example.com/fallback.jpg",
      normArtistKey: "unknownartist",
      normTrackKey: "unknowntrack",
    };

    await persistPlays(db, [play]);

    const [scrobble] = await db.select().from(scrobbles);
    expect(scrobble).toMatchObject({
      id: "scrobble-unresolved",
      userId: "user-2",
      trackSpotifyUri: null,
      albumSpotifyUri: null,
      artistName: "Unknown Artist",
      albumName: "Unknown Album",
      trackName: "Unknown Track",
      coverArtUrl: "https://example.com/fallback.jpg",
    });
  });

  test("is idempotent when storing the same play multiple times", async () => {
    const db = createDatabase(env.DB);
    await seedUser("user-3");

    const play: PlayRecord = {
      id: "scrobble-idempotent",
      userId: "user-3",
      scrobbleDate: now,
      track: {
        spotifyUri: "spotify:track:idempotent",
        name: "Idempotent Track",
        releaseDate: "2026",
        imageUrl: "",
        artists: [{ spotifyUri: "spotify:artist:idempotent", name: "Artist" }],
      },
      album: {
        spotifyUri: "spotify:album:idempotent",
        name: "Idempotent Album",
        releaseDate: "2026",
        totalTracks: 1,
        albumType: "album",
        imageUrl: "",
        artists: [{ spotifyUri: "spotify:artist:idempotent", name: "Artist" }],
      },
    };

    await persistPlays(db, [play]);
    await persistPlays(db, [play]);

    expect(await db.select().from(scrobbles)).toHaveLength(1);
    expect(await db.select().from(tracks)).toHaveLength(1);
    expect(await db.select().from(albums)).toHaveLength(1);
    expect(await db.select().from(artists)).toHaveLength(1);
  });

  test("chunks plays into bounded batches", async () => {
    const batchSpy = vi.spyOn(env.DB, "batch");
    const db = createDatabase(env.DB);
    await seedUser("user-4");

    const plays: PlayRecord[] = Array.from({ length: 5 }, (_, i) => ({
      id: `scrobble-batch-${i}`,
      userId: "user-4",
      scrobbleDate: new Date(now.getTime() + i * 1000),
      trackName: `Track ${i}`,
    }));

    await persistPlays(db, plays, { batchSize: 2 });

    // 5 plays chunked by 2 = 3 batches (2 + 2 + 1)
    expect(batchSpy).toHaveBeenCalledTimes(3);
    expect(await db.select().from(scrobbles)).toHaveLength(5);
  });
});

describe("buildPlayStatements", () => {
  test("orders statements: artists, album, album-artists, track, track-artists, scrobble", () => {
    const db = createDatabase(env.DB);

    const play: PlayRecord = {
      id: "scrobble-test-order",
      userId: "user-1",
      scrobbleDate: now,
      track: {
        spotifyUri: "spotify:track:order",
        name: "Track",
        releaseDate: "2026",
        imageUrl: "",
        artists: [{ spotifyUri: "spotify:artist:track-artist", name: "Track Artist" }],
      },
      album: {
        spotifyUri: "spotify:album:order",
        name: "Album",
        releaseDate: "2026",
        totalTracks: 1,
        albumType: "album",
        imageUrl: "",
        artists: [{ spotifyUri: "spotify:artist:album-artist", name: "Album Artist" }],
      },
    };

    const statements = buildPlayStatements(db, play);
    // 2 artists + 1 album + 1 album-artist + 1 track + 1 track-artist + 1 scrobble = 7 statements
    expect(statements).toHaveLength(7);
  });
});
