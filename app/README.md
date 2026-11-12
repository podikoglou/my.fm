# my.fm web app

The my.fm web application. It is a React Router 7 single-page app, built with
Vite and served by a Cloudflare Worker.

## Development

Run the whole stack from the repository root:

```sh
bun run dev
```

Alchemy prints the app and API URLs. Open the app URL.

To use the HTTPS origin:

```sh
bun run dev:proxy
```

Caddy serves the app at `https://my.fm`. Add `my.fm` to `/etc/hosts` with
address `127.0.0.1`, and run `caddy trust` once so the browser trusts the local
CA.

To run only the app:

```sh
cd app
bun run dev
```

Set `API_DEV_URL` when the API runs at another origin.

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

The stack builds `build/client` and serves it through `worker.ts`.
