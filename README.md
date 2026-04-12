# my.fm Architecture

my.fm is a small [last.fm](https://last.fm) clone.

## Stack

On the fronend, my.fm uses [React 19](https://react.dev). For the design
system, we use [Tailwind](https://tailwindcss.com) and
[9ui](https://www.9ui.dev/) components (which in turn use [Base
UI](https://base-ui.com/)). For routing, we use [React
Router](https://reactrouter.com).

On the backend, we have a [Hono](https://hono.dev) API that runs on Bun and
uses SQLite with Drizzle.
