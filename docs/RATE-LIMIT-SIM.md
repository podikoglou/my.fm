# Rate limit simulator

`sim/` estimates, for a user count and activity level, how many Spotify
requests the ingestion cron issues and whether Spotify's limiters reject
any of them. It exists because Spotify publishes the *structure* of its
limiting but not the numbers, so the honest output is a traffic profile
plus a threshold sweep — never a guaranteed yes/no.

```sh
bun run --cwd sim sim --users 100,500,2000 --sessions 2,6
bun run --cwd sim sim --users 500 --rate-threshold 180 --quota-threshold 600 --days 14
bun run --cwd sim sim --users 500 --rate-threshold none          # traffic only
```

## What Spotify actually enforces

| Mechanism | Window | Scope | Threshold |
|---|---|---|---|
| Rolling rate limit | 30 s, rolling | per developer account (per app before July 2026) | unpublished, differs by quota mode |
| Quota buckets (dev mode) | ~24 h, rolling | per developer account, grouped by endpoint | unpublished, "subject to change" |

Community measurements, not guarantees: roughly 180 requests/minute
sustained for dev-mode apps, and around 600 requests/24 h on at least one
endpoint group. The 429 body distinguishes the two: quota rejections carry
`reason: "QUOTA_EXCEEDED"`; the rolling limit returns an empty body. The
API parses this into `SpotifyQuotaExceededError.reason`, so production
logs can attribute each block.

## What the simulator models

The engine replays the cron loop minute by minute and reuses the real
scheduling decisions — `shouldFetchUser`, `computeQuotaBlock`, the
activity window, the 3/10-minute cadences — imported from
`api/src/ingestion/schedule.ts`, so the simulator cannot drift from the
ingestion service. A fetch takes one page of up to 50 plays after the
cursor, advances the cursor to the newest returned play, and a 429 aborts
the tick and blocks the run for `Retry-After` (30-minute fallback, 24-hour
cap), exactly like `Ingestion.run`.

The rest is assumption, and each one is a sweep parameter:

- **Request latency** (`--request-ms`, default 200): requests within a tick
  are sequential, so latency decides how much of one tick fits inside a
  30-second window.
- **Retry-After**: modelled as the time for the window to drain below the
  threshold. Spotify only says to honour the header.
- **A denied attempt** is not recorded against the limiter's own window (the
  run waits out the block anyway), but *does* count toward the reported
  traffic peaks — Spotify's edge sees it.
- **Listening behaviour**: `sessionsPerDay` sessions per user, 0.5×–1.5× the
  mean length, plays every 3–5 minutes, starts drawn from a diurnal curve
  (`evening` weights 17:00–23:00 ×3).

Not modelled: token refreshes (they hit `accounts.spotify.com`, a different
edge with unknown limits), D1 quotas, per-endpoint bucket differences, and
backfill of plays that predate a user's first fetch.

## Calibration

The thresholds are unknown, so calibrate them from production: every
`ingestion run complete` log line carries the tick's `accounts`, `fetched`,
`skipped` counts and, on rejection, `retryAfterSeconds` and `reason`. A
rejection at a known request volume pins the limiter that rejected it; the
largest volume observed *without* a rejection bounds it from below. Feed
those numbers back as `--rate-threshold` / `--quota-threshold`.
