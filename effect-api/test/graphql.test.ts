import { http, HttpResponse } from "msw";
import { describe, expect, test } from "vitest";

import {
  buildBatchQuery,
  extractResolvedMetadata,
  fetchGraphQLBatch,
  GRAPHQL_ENDPOINT,
  resolveTracksWaterfall,
  spotifyUrlToUri,
  type GqlTrack,
} from "../src/import/graphql.ts";
import { network } from "./network.ts";

describe("GraphQL metadata resolution", () => {
  test("converts Spotify URLs to URIs", () => {
    expect(spotifyUrlToUri("https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT")).toBe(
      "spotify:track:4cOdK2wGLETKBW3PvgPWqT",
    );
    expect(spotifyUrlToUri("https://open.spotify.com/album/1A2B3C4D")).toBe(
      "spotify:album:1A2B3C4D",
    );
    expect(spotifyUrlToUri("https://open.spotify.com/artist/9Z8Y7X")).toBe("spotify:artist:9Z8Y7X");
    expect(spotifyUrlToUri("spotify:track:alreadyUri")).toBe("spotify:track:alreadyUri");
    expect(spotifyUrlToUri("")).toBeNull();
    expect(spotifyUrlToUri(null)).toBeNull();
  });

  test("builds aliased GraphQL batch query with escaped strings", () => {
    const query = buildBatchQuery([
      { key: "k0", artist: 'Artist "One"', title: String.raw`Track \ 1`, album: "Album 1" },
      { key: "k1", artist: "Artist 2", title: "Track 2", album: null },
    ]);

    expect(query).toContain("q0: track(");
    expect(query).toContain(String.raw`artist: "Artist \"One\""`);
    expect(query).toContain(String.raw`title: "Track \\ 1"`);
    expect(query).toContain('album: "Album 1"');
    expect(query).toContain("q1: track(");
    expect(query).not.toContain('album: "null"');
  });

  test("extracts resolved metadata and falls back when track is null", () => {
    const resolved = extractResolvedMetadata("Raw Artist", "Raw Title", "Raw Album", {
      title: "Canonical Title",
      spotifyUrl: "https://open.spotify.com/track/track123",
      album: {
        title: "Canonical Album",
        spotifyUrl: "https://open.spotify.com/album/album123",
        releaseDate: "2020-01-01",
        type: "album",
        coverArt: {
          front500: "https://cover.example/500.jpg",
          front: "https://cover.example/full.jpg",
        },
      },
      artist: {
        name: "Canonical Artist",
        spotifyUrl: "https://open.spotify.com/artist/artist123",
      },
    });

    expect(resolved).toEqual({
      trackSpotifyUri: "spotify:track:track123",
      artistSpotifyUri: "spotify:artist:artist123",
      albumSpotifyUri: "spotify:album:album123",
      coverArtUrl: "https://cover.example/500.jpg",
      artistImageUrl: null,
      albumReleaseDate: "2020-01-01",
      albumType: "album",
      trackName: "Canonical Title",
      artistName: "Canonical Artist",
      albumName: "Canonical Album",
    });

    const fallback = extractResolvedMetadata("Raw Artist", "Raw Title", "Raw Album", null);

    expect(fallback).toEqual({
      trackSpotifyUri: null,
      artistSpotifyUri: null,
      albumSpotifyUri: null,
      coverArtUrl: null,
      artistImageUrl: null,
      albumReleaseDate: "",
      albumType: "album",
      trackName: "Raw Title",
      artistName: "Raw Artist",
      albumName: "Raw Album",
    });
  });

  test("waterfall resolves with album first and retries unresolved items without album", async () => {
    const calls: string[] = [];

    const mockFetch = async (
      _endpoint: string,
      query: string,
    ): Promise<Record<string, GqlTrack | null>> => {
      calls.push(query);

      if (calls.length === 1) {
        return {
          q0: {
            title: "Track 1",
            spotifyUrl: "https://open.spotify.com/track/t1",
            album: {
              title: "Album 1",
              spotifyUrl: "https://open.spotify.com/album/a1",
              releaseDate: "2020",
              type: "album",
            },
            artist: {
              name: "Artist 1",
              spotifyUrl: "https://open.spotify.com/artist/ar1",
            },
          },
          q1: null,
        } satisfies Record<string, GqlTrack | null>;
      }

      return {
        q0: {
          title: "Track 2",
          spotifyUrl: "https://open.spotify.com/track/t2",
          album: {
            title: "Different Album",
            spotifyUrl: "https://open.spotify.com/album/a2",
            releaseDate: "2021",
            type: "album",
          },
          artist: {
            name: "Artist 2",
            spotifyUrl: "https://open.spotify.com/artist/ar2",
          },
        },
      } satisfies Record<string, GqlTrack | null>;
    };

    const resolved = await resolveTracksWaterfall(
      [
        { key: "k0", artist: "Artist 1", title: "Track 1", album: "Album 1" },
        { key: "k1", artist: "Artist 2", title: "Track 2", album: "Wrong Album" },
      ],
      { throttleMs: 0, fetchBatch: mockFetch },
    );

    expect(calls).toHaveLength(2);
    expect(calls[0]).toContain('album: "Wrong Album"');
    expect(calls[1]).not.toContain("album:");
    expect(resolved.get("k0")?.trackSpotifyUri).toBe("spotify:track:t1");
    expect(resolved.get("k1")?.trackSpotifyUri).toBe("spotify:track:t2");
  });

  test("propagates fetch failures instead of silently falling back", async () => {
    await expect(
      resolveTracksWaterfall([{ key: "k0", artist: "Artist", title: "Track", album: "Album" }], {
        throttleMs: 0,
        fetchBatch: async () => {
          throw new Error("upstream down");
        },
      }),
    ).rejects.toThrow("upstream down");
  });

  test("rejects missing expected aliases in GraphQL response", async () => {
    await expect(
      resolveTracksWaterfall([{ key: "k0", artist: "Artist", title: "Track", album: "Album" }], {
        throttleMs: 0,
        fetchBatch: async () => ({}),
      }),
    ).rejects.toThrow("missing expected alias q0");
  });

  test("fetchGraphQLBatch rejects non-OK HTTP responses", async () => {
    network.use(
      http.post(GRAPHQL_ENDPOINT, () => new HttpResponse("rate limited", { status: 429 })),
    );

    await expect(fetchGraphQLBatch(GRAPHQL_ENDPOINT, "{ q0: track { title } }")).rejects.toThrow(
      "GraphQL request failed: 429",
    );
  });

  test("fetchGraphQLBatch rejects GraphQL errors alongside data", async () => {
    network.use(
      http.post(GRAPHQL_ENDPOINT, () =>
        HttpResponse.json({
          data: { q0: null },
          errors: [{ message: "resolver failed" }],
        }),
      ),
    );

    await expect(fetchGraphQLBatch(GRAPHQL_ENDPOINT, "{ q0: track { title } }")).rejects.toThrow(
      "resolver failed",
    );
  });

  test("fetchGraphQLBatch rejects responses without a data envelope", async () => {
    network.use(http.post(GRAPHQL_ENDPOINT, () => HttpResponse.json({})));

    await expect(fetchGraphQLBatch(GRAPHQL_ENDPOINT, "{ q0: track { title } }")).rejects.toThrow(
      "missing data",
    );
  });
});
