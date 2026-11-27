---
name: effect-ui
description: Use when rebuilding or changing the my.fm browser frontend with Effect UI, including routes, query and command Layers, forms, or browser behavior.
---

# Effect UI in my.fm

1. Read the [migration reference](../../../docs/EFFECT-UI.md) and
   [screen inventory](../../../docs/EFFECT-UI-SCREENS.md) first. Use the
   pinned source checkout, not React assumptions or an unpinned website API.
   Keep `@effect/ui` and `@effect/ui-kit` on the same snapshot. Check the
   lockfile, Effect peer resolution, strict typing and exact optional
   property types before investigating inference failures.
2. Start with the existing URL, API and visible states. Keep the API Worker,
   same-origin requests, credential modes, OAuth return paths, forwarded
   Host and SPA fallback contracts. Set `restore: false` on each component
   whose Model or queries hold auth-bound data. A parent opt-out or session
   render guard does not protect a child's snapshot. Keep live cache isolation
   on sign-out and check Back for stale data; see
   [history guidance](../../../docs/EFFECT-UI.md#keep-auth-bound-state-out-of-browser-history).
3. Write a pure component transition first: schema for Model and messages,
   `init`, `update`, and HTML `view`. Pass props down and map child events up.
   Use stable keys, and only re-key to reset an instance intentionally.
   Parse external inputs at the boundary. Put reads in Query Layers, writes
   in Commands and streams/observers in scoped Subscriptions or Mounts.
   Do not introduce Effect elsewhere just to match the UI.
4. Build markup with HTML builders and established Tailwind tokens. For kit
   parts, open the source and DOM tests for the actual event options,
   required tags, keyboard behavior and data attributes. Preserve pending,
   empty, failure and disabled states; keep persistent notifications distinct
   from transient feedback.
5. Use Story for transition logic, Scene when testing component wiring with
   controlled effects, and Play for rendered interactions under the test
   host. Use a real browser for native history, layout, scrolling, focus,
   file selection and redirects. Compare against the existing app through
   the separately owned equivalence suite; report anything not verified.
   Run the repo checks with Bun; see [testing](../../../docs/TESTING.md) for
   the Vitest environment and [code style](../../../docs/CODE-STYLE.md) for
   boundary and lint conventions.
