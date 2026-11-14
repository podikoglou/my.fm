# my.fm Worker API

The API and Spotify ingestion Worker for my.fm. It runs on Cloudflare Workers
with D1, Better Auth, and a Cron Trigger. The resources are declared in
`src/alchemy.ts`. The root Alchemy stack deploys this Worker with the web
application.

## Stack

- Cloudflare Worker with Hono and Better Auth
- D1 database with Drizzle
- Cron Trigger for Spotify ingestion
- Alchemy stack in the repository root

## Run

From the repository root:

```sh
bun install
bun run dev
```

`bun run dev` starts the app, the API, and a local D1 database. Alchemy prints
the app and API URLs.

Deploy or remove this stage:

```sh
bun run deploy
bun run destroy
```

In this package:

```sh
bun run typecheck
bun run lint
bun run fmt
bun run test
bun run db:generate
```

## Configuration

The root `.env` holds `SPOTIFY_CLIENT_ID` and `SPOTIFY_CLIENT_SECRET`.

Alchemy generates `BETTER_AUTH_SECRET` on the first deploy and keeps it in
stack state. Do not set it by hand.

Register the app's Spotify callback URL in the Spotify application. The root
README shows the local callback URL.

## Rate limits

Two Cloudflare Rate Limiting bindings count requests per client address. The
budgets are declared in `src/rate-limits.ts` and enforced by
`src/rate-limit-middleware.ts`.

| Routes                                           | Binding                  | Budget               |
| ------------------------------------------------ | ------------------------ | -------------------- |
| `POST`, `GET` `/api/auth/*`                      | `AUTH_RATE_LIMIT`        | 60 per 60 s          |
| `GET /api/feed`                                  | `PUBLIC_READ_RATE_LIMIT` | 120 per 60 s         |
| `GET /api/user/byUsername`, `GET /api/user/byId` | `PUBLIC_READ_RATE_LIMIT` | shared with the feed |
| `GET /api/scrobble/getRecent`                    | `PUBLIC_READ_RATE_LIMIT` | shared with the feed |

The key is `CF-Connecting-IP`, which Cloudflare sets at the edge and overwrites
if the caller sends one. A request without it, which local development sends,
shares a single budget with every other such request.

A rejected request answers `429` with `{"error":"Too many requests"}` and
`Retry-After: 60`. The binding reports that a key is over budget, not how much
of the window is left, so the header states the whole window.

- `GET /health` and `GET /health/ingestion` are never limited: an uptime
  monitor depends on them.
- The authenticated routes are not limited: a session attributes them to a
  user, and these budgets cover anonymous callers.
- Sign-in and the public reads are counted before the session lookup, so a
  rejected request costs no database query.

Counts are approximate and local to the Cloudflare location that serves the
request, so a burst can exceed the budget and another location keeps its own
count. This is abuse protection, not a quota. A response served from Workers
Cache does not run the Worker and is not counted. The namespace ids are
account-scoped, so the preview stage counts against the same budgets as
production.
