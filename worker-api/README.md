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

## Database changes

Edit `src/db/schema.ts`, then generate the migration:

```sh
bun run db:generate
```

Commit the new files in `drizzle/`. Alchemy applies pending migrations during
the next deploy. The Worker does not run migrations at request time.
