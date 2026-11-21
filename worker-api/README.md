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

## Routes

The API is mounted at `/api`. OAuth 2.1 protocol endpoints and the read-only MCP
server sit at the root. Routes marked "session" answer `401` without a
signed-in user, and `/mcp` answers `401` without a valid OAuth bearer token.

| Route                                         | Access  | Purpose                                     |
| --------------------------------------------- | ------- | ------------------------------------------- |
| `POST`, `GET` `/api/auth/*`                   | public  | Better Auth sign-in, callback and sign-out  |
| `GET /api/user/me`                            | session | The signed-in user                          |
| `GET /api/user/byUsername`, `/byId`           | public  | A profile, unless it is private             |
| `PATCH /api/user/settings`                    | session | Update the profile settings                 |
| `PUT /api/user/onboard`                       | session | Set the name and username                   |
| `GET /api/scrobble/getRecent`                 | public  | A user's recent scrobbles                   |
| `GET /api/scrobble/getMonths`                 | public  | A user's scrobble counts by month           |
| `GET /api/feed`                               | public  | The latest scrobbles from everyone          |
| `GET /api/import/latest`, `POST /api/import`  | session | The latest history import, and a new upload |
| `GET /api/notifications`                      | session | The user's unacknowledged notifications     |
| `POST /api/notifications/:id/acknowledge`     | session | Acknowledge one of the user's notifications |
| `GET /api/oauth/authorize`                    | session | Parse authorization request and client info |
| `POST /api/oauth/authorize`                   | session | Record allow or deny consent decision       |
| `GET /api/oauth/apps`                         | session | List authorized connected applications      |
| `DELETE /api/oauth/apps/:id`                  | session | Revoke access for a connected application   |
| `POST /register`                              | public  | Dynamic client registration                 |
| `POST /token`                                 | public  | OAuth code and refresh exchange             |
| `POST /mcp`                                   | bearer  | Read-only Model Context Protocol server     |
| `GET /.well-known/oauth-authorization-server` | public  | Authorization server metadata               |
| `GET /.well-known/oauth-protected-resource/*` | public  | Resource server metadata                    |
| `GET /health`, `GET /health/ingestion`        | public  | Uptime checks                               |

`POST /api/notifications/:id/acknowledge` answers `404` for an ID that belongs
to another user, the same as for one that does not exist. Acknowledging twice
keeps the first time.

`POST /mcp` is stateless JSON-RPC over Streamable HTTP; GET or DELETE answers
`405`.

## Data model

The Drizzle schema in `src/db/schema.ts` defines the D1 tables, and
`bun run db:generate` writes the migrations in `drizzle/`.

- `users`, `sessions`, `accounts` and `verification` belong to Better Auth.
  `accounts.scope` holds the Spotify scopes that the user granted.
- `scrobbles` holds plays, and `tracks`, `albums`, `artists`, `track_artists`
  and `album_artists` describe them.
- `imports` tracks history uploads; `docs/IMPORT-DESIGN.md` describes them.
- `ingestion_runs` records the cron's runs.
- `OAUTH_KV` stores client registrations, authorization codes, and refresh tokens.
- `notifications` holds messages for one user: `id`, `userId`, `type`,
  `title`, `body`, `createdAt` and `acknowledgedAt`. A notification is unacknowledged
  while `acknowledgedAt` is null, and the app shows it until the user clicks
  it. Deleting a user deletes their notifications.

### Sending a notification

No route creates notifications. Insert a row with D1; the defaults fill in `id`
and `createdAt`:

```sql
INSERT INTO notifications (userId, type, title, body)
VALUES ('<user id>', '<type>', '<title>', '<body>');
```

The API returns `type` as stored and does not interpret it. The app looks the
type up in `app/app/notifications/kinds.ts`, which says how to render it and
what clicking it does. A type that is not listed there renders its title and
body, and clicking it only acknowledges it.

### Spotify reauthorization

The `spotify-reauth` type asks a user to sign in again when their stored
Spotify grant lacks `user-read-currently-playing`, which the app asks for now.
Before listing, `GET /api/notifications` creates it for the signed-in user,
or acknowledges it once their grant has the scope. A partial unique index
keeps at most one unacknowledged one per user. Clicking
it acknowledges it, signs the user out and starts Spotify sign-in.

Better Auth does not update `accounts.scope` when a user signs in again, so a
hook in `src/auth.ts` records the requested scopes on each completed Spotify
sign-in. Spotify grants every requested scope or none.

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

| Routes                                           | Binding                  | Budget                |
| ------------------------------------------------ | ------------------------ | --------------------- |
| `POST`, `GET` `/api/auth/*`                      | `AUTH_RATE_LIMIT`        | 60 per 60 s           |
| `POST /register`, `POST /token`                  | `AUTH_RATE_LIMIT`        | shared with auth      |
| `GET`, `POST` `/api/oauth/authorize`             | `AUTH_RATE_LIMIT`        | shared with auth      |
| `GET /api/feed`                                  | `PUBLIC_READ_RATE_LIMIT` | 120 per 60 s          |
| `GET /api/user/byUsername`, `GET /api/user/byId` | `PUBLIC_READ_RATE_LIMIT` | shared with the feed  |
| `GET /api/scrobble/getRecent`                    | `PUBLIC_READ_RATE_LIMIT` | shared with the feed  |
| `POST /mcp` (tool reads)                         | `PUBLIC_READ_RATE_LIMIT` | 120 per 60 s per user |

The key is `CF-Connecting-IP`, which Cloudflare sets at the edge and overwrites
if the caller sends one. A request without it, which local development sends,
shares a single budget with every other such request.

A rejected request answers `429` with `{"error":"Too many requests"}` and
`Retry-After: 60`. The binding reports that a key is over budget, not how much
of the window is left, so the header states the whole window.

- `GET /health` and `GET /health/ingestion` are never limited: an uptime
  monitor depends on them.
- `POST /register` and `POST /token` are rate limited per client address before
  reaching `OAuthProvider`.
- Tool executions under `POST /mcp` consume `PUBLIC_READ_RATE_LIMIT` keyed by
  the authenticated user ID rather than IP address.
- The authenticated routes are not limited: a session attributes them to a
  user, and these budgets cover anonymous callers. The import routes keep their
  own per-user limit instead, which `docs/IMPORT-DESIGN.md` describes.
- Sign-in and the public reads are counted before the session lookup, so a
  rejected request costs no database query.

Counts are approximate and local to the Cloudflare location that serves the
request, so a burst can exceed the budget and another location keeps its own
count. This is abuse protection, not a quota. A response served from Workers
Cache does not run the Worker and is not counted. The namespace ids are
account-scoped, so the preview stage counts against the same budgets as
production.
