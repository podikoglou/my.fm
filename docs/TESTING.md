# Testing

## Run the suites

Install dependencies with `bun install` and hooks with `bunx lefthook install`.
Use Node.js 22.12+ (or 24+) for the Vitest CLI and Bun for workspace commands:

```sh
bun run test
bun run typecheck
bun run lint
bun run fmt:check
```

Turbo runs each package's `vitest run` script. For watch mode, use
`bun run --cwd api vitest --watch` or `bun run --cwd app vitest --watch`.

## The Workers runtime is real

The API suite runs in workerd through Cloudflare's official
`@cloudflare/vitest-plugin` and its `cloudflareTest()` configuration plugin.
Vitest is pinned to 4.1.x. This package replaces the deprecated
`@cloudflare/vitest-pool-workers`; see the [official integration docs](https://developers.cloudflare.com/workers/testing/vitest-integration/).

`api/vitest.config.ts` declares local Miniflare D1, R2, KV and Rate
Limiting bindings and test-only secrets. Rate limits use the production policies
from `src/rate-limits.ts`. Tests import `env` from `cloudflare:workers` and call
the Effect HTTP API or Worker handlers, not a SQLite shim or an in-memory rate
counter.

The config reads checked-in `drizzle/<timestamp>/migration.sql` files on the
Node side using `readD1Migrations`, sorts them by name, and passes them through
the `TEST_MIGRATIONS` binding. The setup file applies them with
`applyD1Migrations`. A passing test runs production SQL against real D1,
including foreign-key checks and transactional batches.

The current plugin isolates storage per test file, not per individual test.
Before each test, `cloudflare:test`'s `reset()` clears binding storage, then the
setup file reapplies migrations. Keep tests within a file sequential: a
concurrent test could reset another test's database or rate-limit budget.
Rate-limit tests spend the real binding's budget before asserting routing
behaviour; no test-only counter or modified production limit is needed.
The rate-limit suite waits for the next wall-clock window when fewer than five
seconds remain, so the budget does not reset during a test's timeout.

## Spotify fixtures

`test/network.ts` uses `setupNetwork()` from `@msw/cloudflare` with MSW 3.
The setup file enables interception, installs a fail-closed catch-all handler,
and resets handlers and spies after each test. Register fixtures with
`network.use(http.get(...))` or `http.post(...)`; newer handlers take precedence.
Unexpected outbound requests fail instead of reaching Spotify. No test swaps
the global `fetch` function.

Module mocking is banned by the lint. A mock proves that your mock was called,
not that the query is right. Dependencies arrive as parameters from the
factories, so a test supplies a real substitute without one.

## A route

Build the app, seed through the real tables with Drizzle inserts, then call the
app with a path and the test environment, and assert the status and the body.
Seed the real tables, because a fixture that bypasses the schema cannot catch a
constraint that production enforces. The tests use their own host, which matters
for cookies and for the OAuth callback.

## The app package

Those tests use plain Vitest in Node and import the route table and the modules
under test. The website handler tests are pure request-routing unit tests;
they do not exercise Workers runtime APIs. They pin the
places where two files must agree, such as a registered path and the file behind
it. There is no DOM renderer; do not add one
for a question that a table or a pure function can answer.

## What to assert

The behaviour the requirement states, and not the values that the current code
happens to produce. When a test fails, decide which of the two is wrong. A test
is deleted when the behaviour it pins has gone on purpose, or when it pins
nothing we own: a library's behaviour, a constant, or plain query plumbing.
