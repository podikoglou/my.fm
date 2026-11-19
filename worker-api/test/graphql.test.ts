import { http } from "msw";
import { describe, expect, test } from "vitest";

import type { GqlTrack } from "../src/import/graphql.ts";

import {
  buildBatchQuery,
  extractResolvedMetadata,
  fetchGraphQLBatch,
  GRAPHQL_ENDPOINT,
  spotifyUrlToUri,
} from "../src/import/graphql.ts";
import { resolveTracksWaterfall } from "../src/import/resolver.ts";
import { network } from "./network.ts";

describe("graphql helper", () => {
  test("converts spotify URLs to URIs", () => {
    expect(spotifyUrlToUri("https://open.spotify.com/track/2vGPGyQiCuuSZ47k4d2ZFT")).toBe(
      "spotify:track:2vGPGyQiCuuSZ47k4d2ZFT",
    );

    expect(spotifyUrlToUri("https://open.spotify.com/album/4m2880jivSbbyEGAKfITCa")).toBe(
      "spotify:album:4m2880jivSbbyEGAKfITCa",
    );

    expect(spotifyUrlToUri("https://open.spotify.com/artist/3jK9MiCrA42lLAdMGUZpwa")).toBe(
      "spotify:artist:3jK9MiCrA42lLAdMGUZpwa",
    );

    expect(spotifyUrlToUri("spotify:track:2vGPGyQiCuuSZ47k4d2ZFT")).toBe(
      "spotify:track:2vGPGyQiCuuSZ47k4d2ZFT",
    );

    expect(spotifyUrlToUri("")).toBeNull();
    expect(spotifyUrlToUri(null)).toBeNull();
  });

  test("builds batched GraphQL query", () => {
    const query = buildBatchQuery([
      {
        key: "key1",
        artist: "Anderson .Paak",
        title: "Come Home",
        album: "Ventura",
      },
      {
        key: "key2",
        artist: 'AC/DC "Live"',
        title: "Back in Black",
        album: null,
      },
    ]);

    expect(query).toContain("q0: track");
    expect(query).toContain('artist: "Anderson .Paak"');
    expect(query).toContain('album: "Ventura"');
    expect(query).toContain("q1: track");
    expect(query).toContain('\\"Live\\"');
  });

  test("extracts resolved metadata from GraphQL track object", () => {
    const track: GqlTrack = {
      title: "Come Home",
      spotifyUrl: "https://open.spotify.com/track/123",
      coverArt: { front500: "https://coverartarchive.org/front-500.jpg" },
      artist: {
        name: "Anderson .Paak",
        spotifyUrl: "https://open.spotify.com/artist/456",
        imageUrl: "https://artist.jpg",
      },
      album: {
        title: "Ventura",
        releaseDate: "2019-04-11",
        type: "album",
        spotifyUrl: "https://open.spotify.com/album/789",
      },
    };

    const resolved = extractResolvedMetadata("Raw Artist", "Raw Title", "Raw Album", track);

    expect(resolved.trackSpotifyUri).toBe("spotify:track:123");
    expect(resolved.artistSpotifyUri).toBe("spotify:artist:456");
    expect(resolved.albumSpotifyUri).toBe("spotify:album:789");
    expect(resolved.coverArtUrl).toBe("https://coverartarchive.org/front-500.jpg");
    expect(resolved.trackName).toBe("Come Home");
    expect(resolved.artistName).toBe("Anderson .Paak");
    expect(resolved.albumName).toBe("Ventura");
  });

  test("extracts fallback metadata when track is null", () => {
    const fallback = extractResolvedMetadata("Raw Artist", "Raw Title", "Raw Album", null);

    expect(fallback.trackSpotifyUri).toBeNull();
    expect(fallback.albumSpotifyUri).toBeNull();
    expect(fallback.artistSpotifyUri).toBeNull();
    expect(fallback.coverArtUrl).toBeNull();
    expect(fallback.artistName).toBe("Raw Artist");
    expect(fallback.trackName).toBe("Raw Title");
    expect(fallback.albumName).toBe("Raw Album");
  });

  test("resolves tracks via waterfall Pass 1 and Pass 2", async () => {
    const mockDb = {
      pass1_match: {
        title: "Matched In Pass 1",
        spotifyUrl: "https://open.spotify.com/track/p1",
      },
      pass2_match: {
        title: "Matched In Pass 2",
        spotifyUrl: "https://open.spotify.com/track/p2",
      },
    } satisfies Record<string, GqlTrack | null>;

    const mockFetch = async (_endpoint: string, query: string) => {
      const response: Record<string, GqlTrack | null> = {};

      if (query.includes("WithAlbum")) {
        // q0 will match, q1 will fail in pass 1
        response.q0 = mockDb.pass1_match;
        response.q1 = null;
      } else {
        // pass 2 without album: q0 matches
        response.q0 = mockDb.pass2_match;
      }

      return response;
    };

    const items = [
      {
        key: "item1",
        artist: "Artist 1",
        title: "Title 1",
        album: "WithAlbum",
      },
      {
        key: "item2",
        artist: "Artist 2",
        title: "Title 2",
        album: "WithAlbum",
      },
    ];

    const results = await resolveTracksWaterfall(items, {
      throttleMs: 0,
      fetchBatch: mockFetch,
    });

    const res1 = results.get("item1");
    const res2 = results.get("item2");

    expect(res1?.trackSpotifyUri).toBe("spotify:track:p1");
    expect(res2?.trackSpotifyUri).toBe("spotify:track:p2");
  });

  test("propagates fetch errors instead of filling fallback metadata", async () => {
    const fetchBatch = async () => {
      throw new Error("GraphQL request failed: 503 Service Unavailable");
    };

    const items = [
      { key: "item1", artist: "Artist 1", title: "Title 1", album: "WithAlbum" },
      { key: "item2", artist: "Artist 2", title: "Title 2", album: null },
    ];

    await expect(resolveTracksWaterfall(items, { throttleMs: 0, fetchBatch })).rejects.toThrow(
      "503",
    );
  });

  test("fails when the response is missing an expected alias", async () => {
    // An empty data object would otherwise read as a universal no-match.
    const fetchBatch = async (): Promise<Record<string, GqlTrack | null>> => ({});

    const items = [{ key: "item1", artist: "Artist 1", title: "Title 1", album: null }];

    await expect(resolveTracksWaterfall(items, { throttleMs: 0, fetchBatch })).rejects.toThrow(
      "missing alias q0",
    );
  });

  test("fetches fail on a non-OK response status", async () => {
    network.use(http.post(GRAPHQL_ENDPOINT, () => new Response("rate limited", { status: 429 })));

    await expect(fetchGraphQLBatch(GRAPHQL_ENDPOINT, "{ q0: track { title } }")).rejects.toThrow(
      "429",
    );
  });

  test("fetches fail when the response envelope has no data", async () => {
    network.use(
      http.post(GRAPHQL_ENDPOINT, () => Response.json({ errors: [{ message: "boom" }] })),
    );

    await expect(fetchGraphQLBatch(GRAPHQL_ENDPOINT, "{ q0: track { title } }")).rejects.toThrow(
      "missing the data envelope",
    );
  });
});
