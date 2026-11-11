# Cloudflare migration

## Goal

Port the existing Bun API to a Cloudflare Worker without changing its public
interface or application behaviour. Improve the design after the port is
complete.

The existing `api/` package remains unchanged while the port is in progress.
The new implementation lives in `worker-api/`.

## Non-negotiable rules

- Preserve routes, methods, parameters, cookies, status codes, and response
  shapes.
- Preserve the existing Better Auth and Spotify OAuth behaviour.
- Preserve the existing database schema and query behaviour.
- Do not add API redesigns, performance work, reliability work, or unrelated
  bug fixes during the port.
- Use a fresh D1 database. No data migration from `api/data.db` is required.
- Keep the existing Bun API independent from `worker-api/`.
- Do not read or commit secret values. Use Alchemy's documented secret flow.

## Target runtime

- Cloudflare Workers for the API.
- Cloudflare D1 for SQLite data.
- Cloudflare Cron Triggers for Spotify fetching.
- Alchemy for infrastructure and deployment.
- Effect for Worker construction and gradual service migration.
- Hono for the HTTP compatibility surface.
- Drizzle for the schema, generated migrations, and database queries.

Effect is not required in every module immediately. The initial boundary may
use Effect to construct the Worker and provide dependencies while Hono keeps
the existing HTTP contract. If this produces an unclear hybrid, the design
can move to a fully Effect-based application in a later change.

## Stacked pull requests

The migration uses one linear stack:

1. `worker-foundation`
2. `worker-auth`
3. `worker-read-api`
4. `worker-ingestion`

Every pull request must leave `worker-api/`:

- Typecheckable.
- Lintable and format-checkable.
- Runnable with `alchemy dev`.
- Deployable with Alchemy.
- Independently verifiable through a health or slice-specific endpoint.

No CI is added as part of this migration at this time.

## Pull request boundaries

### `worker-foundation`

- Add `worker-api/` as a Bun workspace package.
- Add the Alchemy stack and Cloudflare Worker entrypoint.
- Add the D1 resource and binding.
- Add the D1 migration directory and migration wiring.
- Add a minimal Hono application with a health endpoint.
- Add local development, deployment, and Bun test commands.
- Do not add application tables or authentication.

### `worker-auth`

- Use Better Auth `1.7.20` in `worker-api/`. Alchemy's D1 integration pins
  Drizzle ORM and Drizzle Kit to `1.0.0-rc.5`, which Better Auth `1.6.5` does
  not support. The application schema and auth behaviour stay unchanged, and
  `api/` remains on `1.6.5`.
- Preserve the current Better Auth configuration and Spotify OAuth setup.
- Add the complete application schema, including all current music and
  scrobble tables.
- Add the Better Auth tables and application-specific user columns.
- Add Drizzle queries and hooks required for authentication only.
- Preserve the current `/api/auth/*` interface and session behaviour.

### `worker-read-api`

- Add the read-side database query modules.
- Add the current user and recent-scrobble endpoints.
- Preserve the current `/user/*` and `/scrobble/*` interfaces.
- Export the Hono RPC app type for the web application.
- Keep this slice read-only. It must not ingest Spotify data.

### `worker-ingestion`

- Port the existing Spotify fetch and persistence logic.
- Replace the Bun process scheduler with a Cron Trigger that runs every minute.
  Each run scans the accounts with `providerId = "spotify"`; the in-memory
  queue and the `user.create.after` hook are not ported.
- Preserve the existing fetch limits, cursor updates, and write flow.
- Use one Spotify account row per user when more than one is linked.
- Select the Spotify account by `accountId` for Better Auth `1.7.20`, which no
  longer accepts `providerId`.
- Generate scrobble IDs with Web Crypto SHA-256, keeping the first 16 bytes as
  32 lowercase hex characters.
- Store plays in D1 batches of up to ten plays.
- Do not redesign scheduling or add unrelated reliability behaviour.

Cloudflare Cron Triggers cannot reproduce a five-second production timer. The
port preserves the per-user fetch logic, limits, and cursor updates. A known
limitation remains: with a one-minute trigger and a regular limit of six, a
user who plays more than six tracks in a minute can lose plays. Scheduling
improvements are separate work.

The scan also runs in one invocation. Per-account work consumes D1 queries and
Spotify subrequests, so the Free and Paid per-invocation limits cap the number
of accounts one run can cover. The scan has no rotation; scheduling changes are
separate work.

## Schema and migrations

Drizzle is the schema and migration author for every table, including Better
Auth tables.

```text
Edit Drizzle schema
  -> drizzle-kit generate
  -> review and commit SQL and snapshots
  -> Alchemy applies pending migrations to D1
```

Do not use a second migration owner. Do not run migrations from request-time
Worker code. The new D1 database starts empty.

The new schema is generated from the checked-in TypeScript schema and the
pinned dependency versions, not from the local SQLite database or old
migration history.

### D1 DDL differences

Drizzle Kit `1.0.0-rc.5` writes a text primary key as `text PRIMARY KEY`
without the `NOT NULL` clause. The Bun schema uses `text PRIMARY KEY NOT
NULL`. SQLite permits NULL in a text primary key, so the D1 schema is
slightly weaker.

This port accepts the difference. Every insert path supplies an ID: Better
Auth generates user, account, session, and verification IDs; the application
generates scrobble IDs; and Spotify URIs are the primary keys for artists,
albums, and tracks. Adding `.notNull()` to the Drizzle column does not change
the generated SQL in this Drizzle Kit version.

The same migration writes unique constraints inline instead of as named
indexes, and it uses different foreign key constraint names. Uniqueness and
referential integrity are still enforced. The `users` column order also
differs. No query depends on it.

## Dependencies and tests

- Keep Hono at the current resolved version.
- Use Alchemy's supported Drizzle combination in `worker-api/`: Drizzle ORM and
  Drizzle Kit `1.0.0-rc.5`, with Better Auth `1.7.20`. `api/` stays on its
  current versions.
- Use Bun's test runner.
- Test our integration with Better Auth, not Better Auth internals.
- Add slice-level smoke and HTTP tests as each slice is introduced.

`@spotify/web-api-ts-sdk` is pinned to `1.2.0`, the version the Bun API
resolves.

The direct `zod` range is `^4.3.6` in both packages. A fresh install in
`worker-api/` resolves `zod` 4.6.7, while the existing `api/` install resolves
4.3.6. The request validation rules are the same. Zod error payloads can
differ in detail. Pin `worker-api/` to 4.3.6 if exact error payload parity is
required.

A D1 `db.batch()` call counts as one query against the per-invocation limit.
Ingestion batches writes for up to ten plays. A single batch for a whole fetch
would be one query, but a failure would roll back every play; ten plays per
batch bounds the rollback while keeping an initial fetch of fifty plays at five
batches.

Alchemy's documented local and deployment workflows are the source for Worker,
D1, secret, and migration configuration:

- https://alchemy.run/cloudflare
- https://alchemy.run/cloudflare/data/d1
- https://alchemy.run/better-auth/databases/cloudflare-d1
- https://alchemy.run/environments/secret-providers

## Post-migration: web app integration

After the four migration slices, the repository uses one Alchemy stack in the
root `alchemy.run.ts`. The stack deploys the API Worker, its D1 database, and
the web app. The API resources moved to `worker-api/src/alchemy.ts`, and the
migration directory is anchored to that package.

The web app is a Vite single-page build deployed with
`Cloudflare.Website.StaticSite`. It has a custom Worker entry, `app/worker.ts`,
that serves the built assets and forwards `/api/*`, `/user/*`, `/scrobble/*`,
and `/health` to the API Worker over a service binding. This keeps the browser
on one origin, so the Better Auth session cookie is first-party and the Spotify
callback returns to the app origin. The API route contract is unchanged.

`BETTER_AUTH_URL`, `FRONTEND_URL`, and `SPOTIFY_REDIRECT_URI` now use the app
origin. The app calls its own origin; it does not need a build-time API URL.

`alchemy dev` runs the Vite dev server for the app and the API Worker in local
workerd. Vite proxies the API paths to the API Worker. Alchemy starts local
commands with `NODE_ENV=production`, so the app dev command overrides it to
`development`.

The app's Better Auth client matches the Worker API at `1.7.20`. The `api/`
package pins Better Auth and its Drizzle adapter to `1.6.5`, because the shared
workspace lock would otherwise upgrade the Bun API to `1.7.20`.


