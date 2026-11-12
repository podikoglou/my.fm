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

Spotify applies rate limits to the application, not to the user. When a fetch
returns HTTP 429, the run stops at the first blocked account and does not try
the other accounts. They would fail the same way. The run logs the retry delay
from the `Retry-After` header when Spotify sends one.

The Worker keeps no record of a block, so the next Cron Trigger run tries again
five minutes later and receives the same 429 until Spotify resets the quota.
One blocked call per five minutes uses little quota, and a stored block time
would need a new table.

A block can lose plays. One page holds 50 plays, and the cursor moves to the
newest play in the page. When a block covers more than 50 plays for one user,
the plays between the old cursor and that page are never fetched. The observed
Spotify block lasted about eighteen hours.

Other errors stay isolated per account: the run logs the error and continues
with the next account.

## Observability

Workers Logs and Workers Issues are on (see `observability` in
`src/alchemy.ts`). Every ingestion event is one structured log line: a single
object whose keys Workers Logs indexes. The event names live in
`src/ingestion/events.ts`, and the alerts query them as `attributes['event']`.

`ingestion_run_complete` is logged once per run, whatever the outcome. A run
that catches an error still ends with an invocation outcome of `ok`, so the log
lines are the record of what the run did.

The root Alchemy stack creates these resources for each stage:

| Resource | Fires on |
| --- | --- |
| `QuotaAlert` | Any `ingestion_quota_exhausted` event in ten minutes |
| `StalledAlert` | No `ingestion_run_complete` event in thirty minutes |
| `IssuePolicy` and `IssueAlerts` | A Workers Issue, which groups the errors that the run catches and logs |

Notifications go to the Discord webhook in `DISCORD_ALERT_WEBHOOK`. The stack
reads it at deploy time, and it is not bound to the Worker, so a Worker with no
ingestion alerts can deploy without it.

To read the events by hand:

```sh
cf sql query "SELECT timestamp, message FROM logs.workersLogs
  WHERE scriptName = '<script>' AND attributes['event'] = 'ingestion_quota_exhausted'
  FORMAT JSON" --scope-account <account-id> --time-since <iso> --time-until <iso>
```

## Database changes

Edit `src/db/schema.ts`, then generate the migration:

```sh
bun run db:generate
```

Commit the new files in `drizzle/`. Alchemy applies pending migrations during
the next deploy. The Worker does not run migrations at request time.
