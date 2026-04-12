# my.fm API

This is the new implementation of the my.fm api written in TypeScript and
intended to run in [Bun](https://bun.com). It uses [Hono](https://hono.dev) as
a web framework.

It (currently) stores data in SQLite, since the scale is too small to require
anything heavier. It uses [Drizzle](https://orm.drizzle.team) as an ORM.

A few more notes: the API is _not_ a REST API, it's more RPC-like (since it
uses [Hono's RPC mode](https://hono.dev/docs/guides/rpc) for type safety
between the API and the client.) That being said, the best reference for the
API is currently the type system, particularly the `./src/routes/` directory.
