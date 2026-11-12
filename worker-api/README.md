# my.fm Worker API

The API and Spotify ingestion Worker for my.fm. It runs on Cloudflare Workers
with D1, Better Auth, and a Cron Trigger. The resources are declared in
`src/alchemy.ts`. The root Alchemy stack deploys this Worker with the web
application.

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

The root `.env` holds `SPOTIFY_CLIENT_ID` and `SPOTIFY_CLIENT_SECRET`. Do not
commit this file. `bun run dev` reads it by default. To use another file, run
`bun alchemy dev --env-file <file>` from the repository root.

Alchemy generates `BETTER_AUTH_SECRET` on the first deploy and keeps it in
stack state. Do not set it by hand. The `.alchemy` directory is a local
working directory, not the authoritative state store.

Register the app's Spotify callback URL in the Spotify application. The root
README shows the local callback URL.

## Stack

- Cloudflare Worker with Hono and Better Auth
- D1 database with Drizzle
- Cron Trigger for Spotify ingestion
- Alchemy stack in the repository root

## Ingestion

The Cron Trigger runs the `scheduled` handler every five minutes
(`*/5 * * * *` in `src/alchemy.ts`). Each run fetches one page of 50 plays per
Spotify account. Spotify caps the page at 50 items, so the five minute gap must
fit inside one page for an active user.

Spotify limits the application, not the user. When a fetch returns HTTP 429,
the run stops at the first blocked account and does not try the other accounts.
They would fail the same way.

The block lasts until one fixed instant, which Spotify sends in the
`Retry-After` header. The run stores that instant in the heartbeat row, and
every run before it returns before the first request. A run inside a block
cannot get the plays back, so it would only spend the quota that it waits for.
A missing header waits thirty minutes. A value above one day is clamped, so a
bad header cannot stop ingestion for long.

A block can lose plays. The endpoint returns at most the last 50 plays of a
user, and it cannot page further back, so a block that covers more than 50 plays
loses the older ones. A 15 hour block loses plays for a user who listens more
than about three times an hour. No request can recover them.

Other errors stay isolated per account: the run logs the error and continues
with the next account.

## Observability

Workers Logs and Workers Issues are on (see `observability` in
`src/alchemy.ts`).

A normal event is one object, so Workers Logs indexes its keys and a query
matches `attributes['event']`. A failure logs its event name as the message,
because Workers Issues groups occurrences by that text and shows it as the
issue title. Use several words and keep the message stable: Issues replaces
numbers and other variable parts with a token, and a message that collapses to
one token groups every unrelated failure into the same issue. The event names
live in `src/ingestion/events.ts`.

Every run logs `ingestion run complete` and writes one heartbeat row. A run that
catches an error still ends with an invocation outcome of `ok`, so these are the
record of what the run did.

A run inside a Spotify block logs `ingestion run skipped` as an information
event and writes the heartbeat again. Only the first blocked run logs
`ingestion quota exhausted` as an error: the block is one condition, and an
error per five minutes would hide it under its own occurrences. The heartbeat
stays fresh during a block, so the health route below reports a live schedule
and not a stall.

The root stack creates a Discord webhook and two Workers Issues automations.
One notifies on the first occurrence of an issue. The other notifies when a
resolved issue comes back after a quiet day, which is the shape of a quota
block. The webhook URL comes from `DISCORD_ALERT_WEBHOOK` and is read at deploy
time, so it is not bound to the Worker.

Cloudflare's custom alert policies require a paid plan. The project targets the
Free plan, so the alerts use Workers Issues.

Issues cannot observe an absence of logs, so a Cron Trigger that stops is caught
by `GET /health/ingestion`. It answers `503` when the heartbeat is older than
twenty minutes and `200` otherwise, and it reports `blockedUntil` while Spotify
blocks the application. Point an uptime monitor at that path: with no monitor, a
schedule that stops produces no notification.

To read the events by hand:

```sh
cf sql query "SELECT timestamp, message FROM logs.workersLogs
  WHERE scriptName = '<script>' AND attributes['event'] = 'ingestion run complete'
  FORMAT JSON" --scope-account <account-id> --time-since <iso> --time-until <iso>
```

## Database changes

Edit `src/db/schema.ts`, then generate the migration:

```sh
bun run db:generate
```

Commit the new files in `drizzle/`. Alchemy applies pending migrations during
the next deploy. The Worker does not run migrations at request time.
