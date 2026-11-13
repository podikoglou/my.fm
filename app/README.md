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

## Routing

The page routes are pathless layouts over the root, so a profile is
`/user/:username` and the settings page is `/settings`. A profile is readable
without a session, so it sits outside the guarded layout that redirects `/` and
`/settings` to Spotify. A private profile answers `403` to every visitor except
its owner, and an account appears in public only after onboarding. The API keeps
its own space: the Worker forwards `/api/*` and `/health` to the API Worker and
serves every other path from the SPA build. `api-paths.ts` holds those prefixes,
and `test/worker.test.ts` fails when a page path and an API path overlap.

## Sign-in errors

Better Auth sends OAuth failures to `/auth/error` with `?error=<code>` and an
optional `?error_description=`. The route is `app/routes/auth-error.tsx`, and
`app/lib/auth-paths.ts` holds the path so the redirect target and the route
table cannot drift. `app/lib/auth-errors.ts` maps known codes to readable text,
and the page offers a retry. Tests in `test/routes.test.ts` and
`test/auth-errors.test.ts` fail when the route or a message disappears.

Better Auth reads the error URL from the OAuth state that it stores at the start
of the flow. Failures that occur before it can read that state, such as
`state_not_found`, go to its own `/api/auth/error` page instead. Do not move
`/auth/error` without checking both paths.
