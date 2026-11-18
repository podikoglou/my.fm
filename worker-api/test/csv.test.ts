import { describe, expect, it } from "bun:test";

import {
  parseCsvHeaders,
  parseCsvLine,
  parseScrobbleRow,
  splitCsvLines,
  stripBom,
} from "../src/import/csv.ts";

describe("csv parsing", () => {
  it("strips UTF-8 BOM", () => {
    const withBom = "\uFEFFArtist;Album;Track;Date#user";

    expect(stripBom(withBom)).toBe("Artist;Album;Track;Date#user");
    expect(stripBom("Artist;Album")).toBe("Artist;Album");
  });

  it("parses CSV lines according to RFC 4180 with semicolon delimiter", () => {
    const simple = "Witt Lowry;I Could Not Plan This;Track 1;1644436279000";

    expect(parseCsvLine(simple)).toEqual([
      "Witt Lowry",
      "I Could Not Plan This",
      "Track 1",
      "1644436279000",
    ]);

    const quotedWithSemicolon = 'AC/DC;"Live; Special Edition";Thunderstruck;1644436279000';

    expect(parseCsvLine(quotedWithSemicolon)).toEqual([
      "AC/DC",
      "Live; Special Edition",
      "Thunderstruck",
      "1644436279000",
    ]);

    const escapedQuotes = '"Artist ""The Great""";Album;Track;1644436279000';

    expect(parseCsvLine(escapedQuotes)).toEqual([
      'Artist "The Great"',
      "Album",
      "Track",
      "1644436279000",
    ]);
  });

  it("parses CSV headers and finds required column indices", () => {
    const validHeader = "Artist;Album;AlbumId;Track;Date#user";
    const indices = parseCsvHeaders(validHeader);

    expect(indices).toEqual({
      artistIdx: 0,
      albumIdx: 1,
      trackIdx: 3,
      dateIdx: 4,
    });

    const genericDateHeader = "Artist;Track;Date";
    const indicesGeneric = parseCsvHeaders(genericDateHeader);

    expect(indicesGeneric).toEqual({
      artistIdx: 0,
      albumIdx: -1,
      trackIdx: 1,
      dateIdx: 2,
    });

    const missingTrack = "Artist;Album;Date#user";

    expect(parseCsvHeaders(missingTrack)).toBeNull();

    const missingArtist = "Album;Track;Date#user";

    expect(parseCsvHeaders(missingArtist)).toBeNull();

    const missingDate = "Artist;Album;Track";

    expect(parseCsvHeaders(missingDate)).toBeNull();
  });

  it("parses valid scrobble rows with epoch ms and epoch seconds", () => {
    const indices = {
      artistIdx: 0,
      albumIdx: 1,
      trackIdx: 2,
      dateIdx: 3,
    };

    const rowMs = "Anderson .Paak;Ventura;Come Home;1644436588000";
    const parsedMs = parseScrobbleRow(rowMs, indices);

    expect(parsedMs).toEqual({
      artist: "Anderson .Paak",
      album: "Ventura",
      track: "Come Home",
      playedAt: new Date(1644436588000),
    });

    const rowSec = "Anderson .Paak;Ventura;Come Home;1644436588";
    const parsedSec = parseScrobbleRow(rowSec, indices);

    expect(parsedSec?.playedAt.getTime()).toBe(1644436588000);
  });

  it("handles missing album or empty fields gracefully", () => {
    const indices = {
      artistIdx: 0,
      albumIdx: 1,
      trackIdx: 2,
      dateIdx: 3,
    };

    const rowNoAlbum = "Anderson .Paak;;Come Home;1644436588000";
    const parsed = parseScrobbleRow(rowNoAlbum, indices);

    expect(parsed).toEqual({
      artist: "Anderson .Paak",
      album: null,
      track: "Come Home",
      playedAt: new Date(1644436588000),
    });

    const rowEmptyArtist = ";Ventura;Come Home;1644436588000";

    expect(parseScrobbleRow(rowEmptyArtist, indices)).toBeNull();

    const rowEmptyTrack = "Anderson .Paak;Ventura;;1644436588000";

    expect(parseScrobbleRow(rowEmptyTrack, indices)).toBeNull();

    const rowInvalidDate = "Anderson .Paak;Ventura;Come Home;not-a-date";

    expect(parseScrobbleRow(rowInvalidDate, indices)).toBeNull();
  });

  it("skips rows exceeding length limits", () => {
    const indices = {
      artistIdx: 0,
      albumIdx: 1,
      trackIdx: 2,
      dateIdx: 3,
    };

    const oversizedField = "A".repeat(513) + ";Album;Track;1644436588000";

    expect(parseScrobbleRow(oversizedField, indices)).toBeNull();

    const oversizedLine = "Artist;Album;Track;1644436588000;" + "X".repeat(4100);

    expect(parseScrobbleRow(oversizedLine, indices)).toBeNull();
  });

  it("splits lines with CRLF or LF", () => {
    const crlf = "line1\r\nline2\r\nline3";

    expect(splitCsvLines(crlf)).toEqual(["line1", "line2", "line3"]);

    const lf = "line1\nline2";

    expect(splitCsvLines(lf)).toEqual(["line1", "line2"]);
  });
});
