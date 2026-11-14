# Deployment

Documentation around deployment with alchemy.

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

You can deploy prod with `bun run deploy` and preview with `bun run deploy:preview` .

## Secrets

Don't set the Better Auth secret by hand, and don't replace it. It is minted
once and kept in stack state, and a new value invalidates every session that
Better Auth has issued.

## Migrations

Edit the schema, run `bun run db:generate`, and commit the generated migration
directory. Alchemy applies pending migrations on the next deploy.

## Cache

The API Worker enables Workers Cache. A cache hit is served from the edge and
does not run the Worker. The cache key includes the path and query string, so
API routes are encouraged to be made cache-friendly by having consistent query
strings.

## Free plan limits

The project targets the Free Cloudflare plan.

## Agent Note: Before you change infrastructure

Read <https://alchemy.run/llms-full.txt>. Use the `cf` CLI to confirm a
Cloudflare API or service detail instead of guessing at it.
