# Testing

## The database is real

The harness builds an in-memory SQLite database, applies the checked-in
migrations, and wraps it in a `D1Database` shim with `PRAGMA foreign_keys` on, as
D1 has. A passing test therefore runs the SQL that production runs.

The harness returns a Worker environment. A test that calls Spotify swaps the
global `fetch` for a fixture, so no test reaches the network.

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

Those tests import the route table and the modules under test. They pin the
places where two files must agree, such as a registered path and the file behind
it, or an error code and its message. There is no DOM renderer; do not add one
for a question that a table or a pure function can answer.

## What to assert

The behaviour the requirement states, and not the values that the current code
happens to produce. When a test fails, decide which of the two is wrong. A test
is deleted only when the behaviour it pins has gone on purpose.
