# my.fm

my.fm is a small, self-hosted [last.fm](https://last.fm) clone. It connects to
your Spotify account and keeps a history of the tracks you play.

## What it does

- You sign in with Spotify.
- A Cron Trigger fetches your recently played tracks every minute.
- Your profile shows your listening history, newest first.
- You choose a display name and username after your first sign-in.
- One deployment can serve many users. Spotify may rate-limit a large number
  of users.

## How it works

```text
Browser
   |
   v
App Worker  --->  API Worker  --->  D1
   |                  |
   v                  v
Static assets      Spotify API
```

- The **app** (`app/`) is a React Router single-page build. A Cloudflare
  Worker serves the static assets and sends API requests to the API Worker.
- The **API** (`worker-api/`) is a Hono application on Cloudflare Workers. It
  stores users and scrobbles in D1, handles Spotify sign-in with Better Auth,
  and runs the ingestion job.
- The **stack** (`alchemy.run.ts`) deploys the app, the API, the database, and
  the Cron Trigger together.

The app and the API share one origin. The browser keeps one first-party
session cookie, and the Spotify callback returns to the app origin.

## Stack

The frontend uses [React 19](https://react.dev), [React Router](https://reactrouter.com),
[Tailwind](https://tailwindcss.com), [9ui](https://www.9ui.dev/) components
with [Base UI](https://base-ui.com/), and [TanStack Query](https://tanstack.com/query).

The backend uses [Hono](https://hono.dev), Cloudflare Workers, D1, and
[Drizzle](https://orm.drizzle.team/). [Better Auth](https://better-auth.com)
handles Spotify OAuth. [Alchemy](https://alchemy.run) deploys the full stack.

## Development

You need [Bun](https://bun.sh), a Spotify application, and a Cloudflare account
for deployment.

```sh
cp .env.example .env   # then fill in the Spotify credentials
bun install
bun run dev
```

`bun run dev` runs `alchemy dev` from the repository root. It starts the app,
the API, and a local D1 database, then prints both local URLs. Open the app URL
that it prints.

To use the HTTPS origin:

```sh
bun run dev:proxy
```

Caddy serves the app at `https://my.fm`. Add `my.fm` to `/etc/hosts` with
address `127.0.0.1`, and run `caddy trust` once so the browser trusts the local
CA.

Register the app's Spotify callback URL in the Spotify application. For local
HTTPS development, the callback is
`https://my.fm/api/auth/callback/spotify`.

## Commands

- `bun run dev` starts the app, the API, and a local database.
- `bun run dev:proxy` serves the app over HTTPS with Caddy.
- `bun run deploy` creates or updates this stage's Cloudflare resources.
- `bun run destroy` removes this stage's Cloudflare resources.
- `bun run test` runs the test suites.
- `bun run lint` and `bun run fmt` check and format the code.
- `bun run typecheck` typechecks the packages.
- `bun run typecheck:infra` typechecks the root Alchemy stack.
- `bun run db:generate` writes new D1 migrations after a schema change.

## Deployment

The root `.env` holds the Spotify client ID and secret. Alchemy generates the
Better Auth signing secret on the first deploy and stores it in the Cloudflare
state store configured by `Cloudflare.state()`. The `.alchemy` directory is a
local working directory, not the authoritative store.

```sh
bun run deploy
```

Alchemy applies pending D1 migrations during the deploy. The stack prints the
app URL, the API URL, and the database name.

## Repository layout

- `app/` is the React Router web application.
- `worker-api/` is the Hono API and Spotify ingestion Worker.
- `alchemy.run.ts` declares and deploys both packages as one stack.
- `dev.ts` holds the shared local development ports and host.
- `tools/oxlint/anti-slop/` holds the local lint rules.

## Demo

Here is what it looks like.

![demo!](.github/demo.gif)
