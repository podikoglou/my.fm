---
name: readable-code
description: Use when writing or reviewing TypeScript, defining or validating a data contract, fixing lint feedback, or preparing a commit. Validate at boundaries, derive types from their source, and keep code direct.
---

# Readable code

**Why:** Take a Rust-inspired approach: use the type checker to catch mismatches before the code runs, and validate external data the compiler can't verify. Changing a contract should mean changing its owner, not updating copies in ten files.

## Rules

1. Decode external input where it enters. Prefer Zod for runtime validation in TypeScript; use the host project's established validator if it already has one. With Zod, parse at the boundary and use `z.infer<typeof schema>` for the parsed type instead of maintaining a matching interface by hand. Pass the validated domain value inward.
2. Give each contract one owner. For the same concept, use indexed access types such as `User["id"]` for a field, `Pick` or `Omit` for a projection, and `Awaited<ReturnType<typeof fetchUser>>` when consuming an existing async function's result. Use `keyof typeof` for keys from a runtime definition and `satisfies` to check a value against a contract without replacing its inferred type. Don't tie together types that only happen to look alike.
3. Don't throw away type information with broad `object`, `unknown`, or unsafe dictionary contracts and try to recover it with casts, reflection, or scattered checks. In my.fm, don't chain assertions; a necessary non-const assertion needs a nearby `SAFETY:` comment explaining what already guarantees the type.
4. Name values after what they mean, not their structure (my.fm bans `shape` in symbol names). Separate logical steps with whitespace, comment only on constraints the code can't show, and prefer explicit branches over conditional empty-object spreads. Avoid consecutive eager filter/map passes and copies of growing accumulators when a clear single pass will do.
5. Keep request-scoped dependencies in per-request factories, not shared module state. Use the host project's tools and conventions. If lint keeps flagging the same rule, rethink the boundary or interface instead of suppressing it.

In my.fm, use Effect for the Alchemy stack and worker-side resource declarations, not local business logic; use `yield*` and Effect's matching and tagged APIs there. Conventional Commit types are `feat`, `fix`, `refactor`, `build`, `style`, `docs`, and `chore`; the configured scopes are `app` and `worker-api` when a scope is used.

## my.fm examples

| Do | Don't |
| --- | --- |
| Derive Settings' `FormValues` with `z.infer<typeof formSchema>` (`app/app/routes/app/settings.tsx`); validate the currently-playing response at the Spotify adapter with `playbackSchema.safeParse` (`worker-api/src/ingestion/spotify.ts`). | Maintain a form interface that can drift from its validator, or make every caller cast the raw Spotify response. |
| Use `User["id"]` for an ID and `Pick<User, ...>` for `PublicUser` (`worker-api/src/db/queries/users.ts`). Derive `HistoryScrobble` from its page fetch result (`app/app/hooks/use-history-pages.ts`). | Restate the ID's primitive type or hand-copy fields belonging to the user model or endpoint. |
| Derive `IngestionEventName` from `INGESTION_EVENTS` (`worker-api/src/ingestion/events.ts`) and check the route table with `satisfies RouteConfig` (`app/app/routes.ts`). | Maintain a separate list of event strings or assert that the route table is correct. |

my.fm's sources of truth: `docs/CODE-STYLE.md`, `.oxlintrc.json`, `tools/oxlint/anti-slop/`, `.oxfmtrc.json`, `lefthook.yml`, and `commitlint.config.ts`.

## Pre-PR checklist

- [ ] External values are decoded before use; types and names explain what's passed around.
- [ ] A change to a schema, field type, or function result doesn't require updating hand-copied contracts.
- [ ] I ran the project's formatting, lint, and type checks. In my.fm: `bun run fmt:check`, `bun run lint`, and `bun run typecheck`.
