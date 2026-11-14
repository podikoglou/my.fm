import { describe, expect, test } from "bun:test";

import { spotifyUriToUrl } from "../app/lib/spotify.ts";

describe("spotifyUriToUrl", () => {
  test("turns track, album, and artist Spotify URIs into open.spotify.com URLs", () => {
    expect(spotifyUriToUrl("spotify:track:4cOdK2wGLETKBW3PvgPWqT")).toBe(
      "https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT",
    );
    expect(spotifyUriToUrl("spotify:album:4EcfbzCtbJDk2wMwhT4D1h")).toBe(
      "https://open.spotify.com/album/4EcfbzCtbJDk2wMwhT4D1h",
    );
    expect(spotifyUriToUrl("spotify:artist:2CWWgbxApjbyByxBBCvGTm")).toBe(
      "https://open.spotify.com/artist/2CWWgbxApjbyByxBBCvGTm",
    );
  });

  test("keeps existing web URLs unchanged", () => {
    const trackUrl = "https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT";
    expect(spotifyUriToUrl(trackUrl)).toBe(trackUrl);
  });

  test("returns undefined for null, undefined, or empty values", () => {
    expect(spotifyUriToUrl(undefined)).toBeUndefined();
    expect(spotifyUriToUrl(null)).toBeUndefined();
    expect(spotifyUriToUrl("")).toBeUndefined();
  });
});
