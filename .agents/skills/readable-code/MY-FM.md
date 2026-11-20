# my.fm TypeScript references

| Contract | Example |
| --- | --- |
| Boundary validation | `app/app/routes/app/settings.tsx` derives `FormValues` from its Zod schema. `worker-api/src/ingestion/spotify.ts` parses currently playing data at the Spotify adapter. |
| Shared model | `worker-api/src/db/queries/users.ts` uses `User["id"]` and derives `PublicUser` with `Pick`. |
| Function result | `app/app/hooks/use-history-pages.ts` derives `HistoryScrobble` from the page fetch's resolved array element. |
| Runtime definition | `worker-api/src/ingestion/events.ts` derives event names from the constant table. `app/app/routes.ts` checks its route table with `satisfies RouteConfig`. |

- For type assertions, use a single assertion with a nearby `SAFETY:` comment naming the invariant that proves the type.
- For anti-slop rules and Effect scope, read `docs/CODE-STYLE.md` and `.oxlintrc.json`. Run `bun run fmt:check`, `bun run lint`, and `bun run typecheck`.
- Before committing, use the Conventional Commit types and optional scopes in `commitlint.config.ts`.
