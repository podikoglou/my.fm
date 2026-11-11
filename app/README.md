# my.fm web app

The my.fm web application. It is a React Router 7 single-page app
(`ssr: false`), built with Vite and served from a Cloudflare Worker.

## Development

Run the whole stack from the repository root:

```sh
bun run dev
```

Alchemy prints the app and API URLs. Vite proxies the shared API path list
(`/api/*`, `/user/*`, `/scrobble/*`, and `/health`) to the API Worker on the
shared dev port, so the browser uses one origin and the Better Auth session
cookie stays first-party.

To run only the app:

```sh
cd app
bun run dev
```

The dev server then has no API behind its proxy. Set `API_DEV_URL` to point it
at another API origin.

To use the HTTPS origin, start Caddy from the repository root with
`bun run dev:proxy`. Caddy terminates TLS for `my.fm` and forwards every path
to the Vite dev server, so the browser uses `https://my.fm` and the Spotify
callback keeps the production shape. `my.fm` must resolve to `127.0.0.1`.

## API access

The browser calls the app origin. The app Worker in `worker.ts` serves the
built assets and forwards the API paths to the API Worker through the `API`
service binding from `../alchemy.run.ts`. The Hono client type comes from the
`@my.fm/worker-api` workspace package as a type-only import.

## Commands

```sh
bun run build      # react-router build; output in build/client
bun run typecheck  # react-router typegen && tsgo
bun run test       # bun test
bun run lint       # oxlint
bun run fmt        # oxfmt
```

## Deployment

The root Alchemy stack deploys this app with the API:

```sh
bun run deploy
```

`Cloudflare.Website.StaticSite` runs `bun run build`, uploads `build/client`,
and serves it through `worker.ts`.

The Better Auth signing secret is generated on the first deploy and stored in
the Cloudflare state store configured by `Cloudflare.state()`. `.alchemy` is
only a local working directory and is not the authoritative store.
