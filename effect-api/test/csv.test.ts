import { describe, expect, test } from "vitest";

import {
  parseCsvHeaders,
  parseCsvLine,
  parseScrobbleRow,
  splitCsvLines,
  stripBom,
} from "../src/import/csv.ts";

describe("CSV parsing", () => {
  test("strips UTF-8 BOM", () => {
    expect(stripBom("\uFEFFArtist;Album;Track;Date#user")).toBe("Artist;Album;Track;Date#user");
    expect(stripBom("Artist;Album;Track;Date#user")).toBe("Artist;Album;Track;Date#user");
  });

  test("parses semicolon-delimited fields with quotes", () => {
    expect(parseCsvLine("Witt Lowry;I Could Not Plan This;Track 1;1644436279000")).toEqual([
      "Witt Lowry",
      "I Could Not Plan This",
      "Track 1",
      "1644436279000",
    ]);

    expect(parseCsvLine('"Artist; with semicolon";Album;"Track; name";1644436279000')).toEqual([
      "Artist; with semicolon",
      "Album",
      "Track; name",
      "1644436279000",
    ]);

    expect(parseCsvLine('"Artist ""The Great""";Album;Track;1644436279000')).toEqual([
      'Artist "The Great"',
      "Album",
      "Track",
      "1644436279000",
    ]);
  });

  test("parses valid headers", () => {
    const headers = parseCsvHeaders("Artist;Album;Album Artist;Track;Date#user_123");

    expect(headers).toEqual({
      artistIdx: 0,
      albumIdx: 1,
      trackIdx: 3,
      dateIdx: 4,
    });
  });

  test("parses headers with generic Date column and no Album", () => {
    const headers = parseCsvHeaders("Track;Artist;Date");

    expect(headers).toEqual({
      artistIdx: 1,
      albumIdx: -1,
      trackIdx: 0,
      dateIdx: 2,
    });
  });

  test("rejects headers missing required columns", () => {
    expect(parseCsvHeaders("Artist;Album;Date")).toBeNull();
    expect(parseCsvHeaders("Album;Track;Date")).toBeNull();
    expect(parseCsvHeaders("Artist;Album;Track")).toBeNull();
  });

  test("parses scrobble row with ms and seconds timestamps", () => {
    const indices = { artistIdx: 0, albumIdx: 1, trackIdx: 2, dateIdx: 3 };

    const rowMs = parseScrobbleRow("Anderson .Paak;Ventura;Come Home;1644436588000", indices);

    expect(rowMs).toEqual({
      artist: "Anderson .Paak",
      album: "Ventura",
      track: "Come Home",
      playedAt: new Date(1_644_436_588_000),
    });

    const rowSec = parseScrobbleRow("Anderson .Paak;Ventura;Come Home;1644436588", indices);

    expect(rowSec).toEqual({
      artist: "Anderson .Paak",
      album: "Ventura",
      track: "Come Home",
      playedAt: new Date(1_644_436_588_000),
    });
  });

  test("handles empty album as null", () => {
    const indices = { artistIdx: 0, albumIdx: 1, trackIdx: 2, dateIdx: 3 };
    const row = parseScrobbleRow("Artist;;Track;1644436588000", indices);

    expect(row?.album).toBeNull();
  });

  test("rejects rows with missing required values or invalid timestamps", () => {
    const indices = { artistIdx: 0, albumIdx: 1, trackIdx: 2, dateIdx: 3 };

    expect(parseScrobbleRow(";Album;Track;1644436588000", indices)).toBeNull();
    expect(parseScrobbleRow("Artist;Album;;1644436588000", indices)).toBeNull();
    expect(parseScrobbleRow("Artist;Album;Track;notanumber", indices)).toBeNull();
    expect(parseScrobbleRow("Artist;Album;Track;0", indices)).toBeNull();
    expect(parseScrobbleRow("Artist;Album;Track;-100", indices)).toBeNull();
  });

  test("rejects excessively long lines or fields", () => {
    const indices = { artistIdx: 0, albumIdx: 1, trackIdx: 2, dateIdx: 3 };

    const longField = "A".repeat(513);

    expect(parseScrobbleRow(`${longField};Album;Track;1644436588000`, indices)).toBeNull();

    const longLine = "A".repeat(4097);

    expect(parseScrobbleRow(longLine, indices)).toBeNull();
  });

  test("splits CRLF and LF lines while preserving newlines inside quoted fields", () => {
    expect(splitCsvLines("a;b\r\nc;d\ne;f")).toEqual(["a;b", "c;d", "e;f"]);

    expect(splitCsvLines('Artist;Album;Track;Date\n"Line 1\nLine 2";Album;Track;123')).toEqual([
      "Artist;Album;Track;Date",
      '"Line 1\nLine 2";Album;Track;123',
    ]);

    expect(splitCsvLines('Artist;Album;Track;Date\r\n"Line 1\r\nLine 2";Album;Track;123')).toEqual([
      "Artist;Album;Track;Date",
      '"Line 1\r\nLine 2";Album;Track;123',
    ]);

    expect(splitCsvLines('"A ""quoted""\nvalue";B\n"Ends with """;D\n')).toEqual([
      '"A ""quoted""\nvalue";B',
      '"Ends with """;D',
      "",
    ]);
  });
});
