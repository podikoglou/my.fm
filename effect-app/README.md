# Effect UI app

This is the standalone Effect UI rebuild. The existing React app and production
deployment remain unchanged. Only the shell, notifications and public feed are
implemented here; the other routes are migration placeholders.

From the repository root:

```sh
bun install
bun run dev                  # Existing app, API and local database
bun run dev:effect           # Effect UI app on port 5174
bun run dev:effect:proxy     # Caddy: https://my.fm → Effect UI
```

Use the existing hosts entry and local certificates described in the root
README. Stop the original `dev:proxy` process before starting `dev:effect:proxy`;
both serve the same origin, so only one can run at a time. `dev:proxy` still
selects React.

Spotify sign-in must use `https://my.fm`, not `http://localhost:5174`: the API's
trusted origin, secure session cookie and registered Spotify callback remain
`https://my.fm/api/auth/callback/spotify`. Vite preserves the browser's Host
header while forwarding API requests. `API_DEV_URL` can select a different local
API server for fixtures.

```sh
bun run build:effect
bun run --cwd effect-app typecheck
bun run --cwd effect-app fmt:check
```
