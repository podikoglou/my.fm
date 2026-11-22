# Listening history import

How CSV exports of listening history are ingested and resolved.

## Storage and pacing

Imports use an R2 bucket and a cursor to avoid D1 write bursts:

```
+-------------+  POST CSV (< 10 MB)   +----------------+  Store in R2   +--------------------+
| User Client | --------------------> | api     | -------------> | R2: imports/<id>   |
+-------------+                       +----------------+                +--------------------+
       ^                                      |
       | 202 Accepted (< 300 ms)              | 1 row insert
       +--------------------------------------+ v
                                      +--------------------+
                                      | D1: imports        |
                                      | cursor: 0          |
                                      | status: 'pending'  |
                                      +--------------------+
                                                ^
                                                | 1-min Cron Trigger
                                                v
                                      +--------------------+
                                      | worker cron        |
                                      | lines[cursor..+500]|
                                      +--------------------+
                                                |
                                                | 1. Batched GraphQL (100 / req)
                                                v
                                      +--------------------+
                                      | music.aleep.lol    |
                                      +--------------------+
                                                |
                                                | 2. Paced D1 batch writes
                                                v
                                      +--------------------+
                                      | D1: scrobbles      |
                                      | D1: tracks/albums  |
                                      +--------------------+
```

1. The client uploads a CSV file up to 10 MB.
2. The upload route checks the headers and the first rows, stores the file in R2 and writes one row to `imports` with `status: 'pending'` and `cursor: 0`.
3. The cron job, which runs every minute, loads the file from R2, slices 500 lines starting at `cursor`, resolves metadata via GraphQL, writes plays to D1, and advances `cursor`.
4. When `cursor` reaches the end of the file, the import is marked `'completed'` and the R2 object is removed.

## Accepted CSV format

The importer accepts listening history CSV exports:

| Column  | Header             | Required    | Behavior                      |
| ------- | ------------------ | ----------- | ----------------------------- |
| Artist  | `Artist`           | yes         | Empty skips row               |
| Album   | `Album`            | header only | Empty allowed                 |
| AlbumId | `AlbumId`          | header only | Ignored                       |
| Track   | `Track`            | yes         | Empty skips row               |
| Date    | `Date` or `Date#…` | yes         | Epoch milliseconds or seconds |

- Encoding: UTF-8. Strips leading BOM (`\uFEFF`); rejects invalid UTF-8 with `422`.
- Delimiter: `;`, RFC 4180 quoting (`""` literal quote; `;` and newlines allowed in quotes).
- Limits: 10 MB maximum body, 4 KB maximum line length, 512-character maximum field length.
- Rate limits: 1 active upload in flight per user; 1 upload per user per hour.

## Entity model

`tracks`, `albums`, and `artists` hold canonical metadata only. No placeholder rows are created for unresolved plays:

- Plays appear in `scrobbles` with source strings (`artistName`, `albumName`, `trackName`) and nullable `trackSpotifyUri`, `albumSpotifyUri`, and `coverArtUrl`.
- When metadata resolves, canonical entities are upserted into `tracks`, `albums`, and `artists`, and the matching `scrobbles` rows link to them.
- Plays that remain unresolved continue to display using their stored source text and cover art fallback.

## Plays that are already recorded

An export can cover a period that Spotify ingestion already recorded. The two
sources share no ID and no exact time: an export stamps the start of a
play, in whole seconds. So each run reads the user's recorded plays around its
rows and skips a row when a recorded play of the same normalized artist and
title lies within 10 minutes of it. A skipped row counts in `skippedRows`.
