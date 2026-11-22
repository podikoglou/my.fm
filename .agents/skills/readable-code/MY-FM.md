# my.fm TypeScript references

| Contract | Example |
| --- | --- |
| Boundary validation | `app/app/routes/app/settings.tsx` derives `FormValues` from its Zod schema. `api/src/api/` defines Effect `Schema` contracts shared by server handlers and the frontend `HttpApiClient`. |
| Shared model | `api/src/users/service.ts` derives `PublicUser` from the Drizzle `User` row type. |
| Function result | `app/app/hooks/use-history-pages.ts` derives `HistoryScrobble` from the `HttpApiClient` response type. |
| Runtime definition | `api/src/rate-limits.ts` derives binding names from the constant table. `app/app/routes.ts` checks its route table with `satisfies RouteConfig`. |

- For type assertions, use a single assertion with a nearby `SAFETY:` comment naming the invariant that proves the type.
- For anti-slop rules and Effect scope, read `docs/CODE-STYLE.md` and `.oxlintrc.json`. Run `bun run fmt:check`, `bun run lint`, and `bun run typecheck`.
- Before committing, use the Conventional Commit types and optional scopes in `commitlint.config.ts`.
