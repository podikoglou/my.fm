# my.fm

my.fm is a small, self-hosted [last.fm](https://last.fm) clone. It connects to
your Spotify account and keeps a history of the tracks you play.

## Architecture
- The app (`app/`) is a simple React served over a Cloudflare Worker
- The API (`worker-api/`) is a Hono application also on Cloudflare Workers. It
  fetches users' recently played tracks every minute through a cron trigger and
  stores them in D1.

Both components are deployed with [Alchemy](https://alchemy.run).

## Development

You need [Bun](https://bun.sh) and a [Spotify
application](https://developer.spotify.com/). I also suggest
[Caddy](https://caddyserver.com/) for proxying through a HTTPs-enabled domain.

Your Spotify app should have a redirect URI of `https://my.fm/api/auth/callback/spotify` 

```sh
cp .env.example .env # then fill in the Spotify credentials
bun install
bun run dev
```

To use the Caddy proxy:

```sh
bun run dev:proxy
```

Add an entry to your `/etc/hosts` such as:
```
127.0.0.1		my.fm
```

You can go to <https://my.fm>.

### Commands
Useful commands:

- `bun run dev` starts the app, the API, and a local database.
- `bun run dev:proxy` serves the app over HTTPS with Caddy.
- `bun run deploy` creates or updates this stage's Cloudflare resources.
- `bun run destroy` removes this stage's Cloudflare resources.
- `bun run test` runs the test suites.
- `bun run lint` and `bun run fmt` check and format the code.
- `bun run typecheck` typechecks the packages.
- `bun run typecheck:infra` typechecks the root Alchemy stack.
- `bun run db:generate` writes new migrations after a schema change.

## Demo

Here is what it looks like:

![demo!](.github/demo.gif)
