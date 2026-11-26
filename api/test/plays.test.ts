import { env } from "cloudflare:workers";
import { Effect, Layer } from "effect";
import { describe, expect, test, vi } from "vitest";

import type { PlayRecord } from "../src/db/queries/scrobbles.ts";
import { DbLive } from "../src/db/service.ts";
import { Scrobbles } from "../src/scrobbles/service.ts";
import { Users } from "../src/users/service.ts";
import { insertRows, selectRows } from "./d1.ts";

const now = new Date("2026-11-20T12:00:00.000Z");

async function seedUser(userId = "user-1") {
  await insertRows(env.DB, "users", {
    id: userId,
    username: `user-${userId}`,
    name: "Test User",
    email: `${userId}@example.com`,
    updatedAt: now,
  });
}

function runScrobbles<A, E>(effect: Effect.Effect<A, E, Scrobbles>) {
  const dbLayer = DbLive(env.DB);
  const usersLayer = Users.layer.pipe(Layer.provide(dbLayer));
  const layer = Scrobbles.layer.pipe(Layer.provide(Layer.mergeAll(dbLayer, usersLayer)));

  return Effect.runPromise(effect.pipe(Effect.provide(layer)));
}

describe("persistPlays", () => {
  test("persists catalog entities and scrobble in dependency order", async () => {
    const db = env.DB;
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

    await runScrobbles(
      Effect.gen(function* () {
        const service = yield* Scrobbles;
        yield* service.persistPlays([play]);
      }),
    );

    const storedArtists = await selectRows(db, "artists", "spotifyUri");
    expect(storedArtists.map((a) => a.name)).toEqual([
      "Primary Artist",
      "Featured Artist",
      "Producer Artist",
    ]);

    const [album] = await selectRows(db, "albums");
    expect(album).toMatchObject({
      spotifyUri: "spotify:album:1",
      name: "Test Album",
      releaseDate: "2026",
      totalTracks: 10,
      albumType: "album",
      imageUrl: "https://example.com/album.jpg",
    });

    const [track] = await selectRows(db, "tracks");
    expect(track).toMatchObject({
      spotifyUri: "spotify:track:1",
      name: "Test Track",
      trackNumber: 1,
      duration: 200_000,
    });

    const storedTrackArtists = await selectRows(db, "track_artists", "position");
    expect(
      storedTrackArtists.map(({ artistSpotifyUri, position }) => [artistSpotifyUri, position]),
    ).toEqual([
      ["spotify:artist:1", 0],
      ["spotify:artist:2", 1],
    ]);

    const storedAlbumArtists = await selectRows(db, "album_artists", "position");
    expect(
      storedAlbumArtists.map(({ artistSpotifyUri, position }) => [artistSpotifyUri, position]),
    ).toEqual([
      ["spotify:artist:1", 0],
      ["spotify:artist:3", 1],
    ]);

    const [scrobble] = await selectRows(db, "scrobbles");
    expect(scrobble).toMatchObject({
      id: "scrobble-1",
      userId: "user-1",
      trackSpotifyUri: "spotify:track:1",
      albumSpotifyUri: "spotify:album:1",
      scrobbleDate: now,
    });
  });

  test("persists an unresolved play without catalog entities", async () => {
    const db = env.DB;
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

    await runScrobbles(
      Effect.gen(function* () {
        const service = yield* Scrobbles;
        yield* service.persistPlays([play]);
      }),
    );

    const [scrobble] = await selectRows(db, "scrobbles");
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
    const db = env.DB;
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

    await runScrobbles(
      Effect.gen(function* () {
        const service = yield* Scrobbles;
        yield* service.persistPlays([play]);
        yield* service.persistPlays([play]);
      }),
    );

    expect(await selectRows(db, "scrobbles")).toHaveLength(1);
    expect(await selectRows(db, "tracks")).toHaveLength(1);
    expect(await selectRows(db, "albums")).toHaveLength(1);
    expect(await selectRows(db, "artists")).toHaveLength(1);
  });

  test("chunks plays into bounded batches", async () => {
    const batchSpy = vi.spyOn(env.DB, "batch");
    const db = env.DB;
    await seedUser("user-4");

    const plays: PlayRecord[] = Array.from({ length: 5 }, (_, i) => ({
      id: `scrobble-batch-${i}`,
      userId: "user-4",
      scrobbleDate: new Date(now.getTime() + i * 1000),
      trackName: `Track ${i}`,
    }));

    await runScrobbles(
      Effect.gen(function* () {
        const service = yield* Scrobbles;
        yield* service.persistPlays(plays, { batchSize: 2 });
      }),
    );

    // 5 plays chunked by 2 = 3 batches (2 + 2 + 1)
    expect(batchSpy).toHaveBeenCalledTimes(3);
    expect(await selectRows(db, "scrobbles")).toHaveLength(5);
  });
});
