import { describe, expect, test } from "vitest";

import {
  computeImportScrobbleId,
  computeNormKeys,
  normalizeArtist,
  normalizeText,
} from "../src/import/normalize.ts";

describe("Track and artist normalization", () => {
  test("normalizes diacritics, homoglyphs, ampersands, and punctuation", () => {
    expect(normalizeText("Café")).toBe("cafe");
    expect(normalizeText("Beyoncé")).toBe("beyonce");
    expect(normalizeText("\u039Aako")).toBe("kako");
    expect(normalizeText("Fish & Chips")).toBe("fish and chips");
    expect(normalizeText("Don't Stop")).toBe("dont stop");
  });

  test("cuts artist names at collaboration markers", () => {
    expect(normalizeArtist("Kanye West feat. Rihanna")).toBe("kanye west");
    expect(normalizeArtist("Drake ft. Future")).toBe("drake");
    expect(normalizeArtist("Artist 1 / Artist 2")).toBe("artist 1");
    expect(normalizeArtist("Taylor Swift with Bon Iver")).toBe("taylor swift");
    expect(normalizeArtist("David Guetta vs. Morten")).toBe("david guetta");
  });

  test("computes deterministic 32-char lowercase hex norm keys", async () => {
    const base = await computeNormKeys("Anderson .Paak", "Come Home");
    const collab = await computeNormKeys("Anderson .Paak feat. André 3000", "Come Home");

    expect(base.normArtistKey).toMatch(/^[0-9a-f]{32}$/);
    expect(base.normTrackKey).toMatch(/^[0-9a-f]{32}$/);
    expect(collab.normArtistKey).toBe(base.normArtistKey);
    expect(collab.normTrackKey).toBe(base.normTrackKey);
  });

  test("computes deterministic import scrobble IDs scoped by user", async () => {
    const id1 = await computeImportScrobbleId("user-1", "2022-02-09T19:56:28.000Z", "abc123");
    const id2 = await computeImportScrobbleId("user-1", "2022-02-09T19:56:28.000Z", "abc123");
    const otherUser = await computeImportScrobbleId("user-2", "2022-02-09T19:56:28.000Z", "abc123");

    expect(id1).toBe(id2);
    expect(id1).toMatch(/^[0-9a-f]{32}$/);
    expect(otherUser).not.toBe(id1);
  });
});
