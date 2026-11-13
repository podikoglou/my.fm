# Deployment

Cloudflare resources, stages and secrets. `worker-api/README.md` is the source of
truth for ingestion behaviour and alerting, and this file does not repeat it.

## One stack

`alchemy.run.ts` declares every resource. `bun run deploy` updates the current
stage and `bun run destroy` removes it.

## A stage is a full copy

Each stage has its own Worker names, its own D1 database and its own Better Auth
secret. The preview stage takes its hostname from the deploy environment
(`WEBSITE_DOMAIN_PREVIEW`), and a stage with none serves its `workers.dev` URL.
A hostname needs a matching Spotify redirect URI, because Better Auth derives the
callback from the request origin. Without it, sign-in fails while the deploy
succeeds.

## Secrets

Never set the Better Auth secret by hand, and never replace it. It is minted
once and kept in stack state, and a new value invalidates every session that
Better Auth has issued. `.alchemy` is a local working directory, not the state
store.

## Migrations

Edit the schema, run `bun run db:generate`, and commit the generated migration
directory. Alchemy applies pending migrations on the next deploy. The Worker
never migrates at request time, so a schema change that ships without a
migration fails in production rather than in review.

## Cache

The API Worker enables Workers Cache. A cache hit is served from the edge and
does not run the Worker. The cache key includes the path and query string, so
each feed cursor page has its own entry.

Only `GET /api/feed` is public. Every other response is `private, no-store`,
set in `worker-api/src/app.ts`. The default matters: user routes authenticate
with a cookie, and the automatic cache bypass only covers `Authorization` and
`Set-Cookie`. Without the default, a user-specific response could be stored and
served to another user.

A cached feed page can still show a profile that has just become private until
its cache lifetime expires: 30 seconds for the first page and 5 minutes for a
cursor page. The next request after that reads the current privacy setting.

`alchemy dev` does not emulate Workers Cache. Check the `Cf-Cache-Status`
response header on a deployed stage.

## Free plan limits

The project targets the Cloudflare Free plan. Custom alert policies need a paid
plan, so alerting uses Workers Issues automations instead. Do not add a custom
alert policy.

## Before you change infrastructure

Read <https://alchemy.run/llms-full.txt>. Use the `cf` CLI to confirm a
Cloudflare API or service detail instead of guessing at it.
