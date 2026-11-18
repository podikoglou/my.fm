import { describe, expect, it } from "bun:test";

import {
  computeImportScrobbleId,
  computeNormKeys,
  normalizeArtist,
  normalizeText,
} from "../src/import/normalize.ts";

describe("normalization", () => {
  it("normalizes text with NFKD and strips diacritics", () => {
    expect(normalizeText("Café")).toBe("cafe");
    expect(normalizeText("Beyoncé")).toBe("beyonce");
  });

  it("handles homoglyphs", () => {
    // Greek capital Kappa in "Κako"
    expect(normalizeText("\u039Aako")).toBe("kako");
  });

  it("replaces & with and and removes apostrophes", () => {
    expect(normalizeText("Fish & Chips")).toBe("fish and chips");
    expect(normalizeText("Don't Stop")).toBe("dont stop");
  });

  it("cuts artist collaborations at feat, ft, with, vs, and slash", () => {
    expect(normalizeArtist("Kanye West feat. Rihanna")).toBe("kanye west");
    expect(normalizeArtist("Drake ft. Future")).toBe("drake");
    expect(normalizeArtist("Artist 1 / Artist 2")).toBe("artist 1");
    expect(normalizeArtist("Taylor Swift with Bon Iver")).toBe("taylor swift");
    expect(normalizeArtist("David Guetta vs. Morten")).toBe("david guetta");
  });

  it("generates deterministic 32-hex keys", async () => {
    const keys = await computeNormKeys("Kanye West feat. Rihanna", "Famous");
    expect(keys.normArtistKey).toMatch(/^[0-9a-f]{32}$/);
    expect(keys.normTrackKey).toMatch(/^[0-9a-f]{32}$/);

    const keys2 = await computeNormKeys("Kanye West", "Famous");
    expect(keys2.normArtistKey).toBe(keys.normArtistKey);
    expect(keys2.normTrackKey).toBe(keys.normTrackKey);
  });

  it("generates deterministic scrobble id from user, timestamp, and normTrackKey", async () => {
    const keys = await computeNormKeys("Malcolm Todd", "Earrings");

    const id = await computeImportScrobbleId(
      "user-1",
      "2026-11-17T20:00:00.000Z",
      keys.normTrackKey,
    );

    expect(id).toMatch(/^[0-9a-f]{32}$/);

    const idSame = await computeImportScrobbleId(
      "user-1",
      "2026-11-17T20:00:00.000Z",
      keys.normTrackKey,
    );

    expect(idSame).toBe(id);

    const idDiffUser = await computeImportScrobbleId(
      "user-2",
      "2026-11-17T20:00:00.000Z",
      keys.normTrackKey,
    );

    expect(idDiffUser).not.toBe(id);
  });
});
