# my.fm screen and runtime inventory

Companion to the [Effect UI reference](EFFECT-UI.md). The current URL table is
[`app/app/routes.ts`](../app/app/routes.ts); behaviors below come from its
route modules and their hooks/components. The Effect UI column is a proposed
mapping, not a result from the separate equivalence suite.

| URL / surface      | Current behavior to preserve                                                                                                                                                                                                                                                                                            | Effect UI mapping                                                                                                                                                                                                                                                                        |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/`                | [Index loader](../app/app/routes/index.tsx) redirects to `/feed`.                                                                                                                                                                                                                                                       | Unconditional `Route.redirect`; check a direct hit and browser Back.                                                                                                                                                                                                                     |
| `/feed`            | [Public feed](../app/app/routes/feed.tsx), no session needed; [feed list](../app/app/components/feed-track-list.tsx) omits credentials on its request, uses an opaque cursor, sentinel paging, and distinct empty and failure views.                                                                                    | `Feed` route, shell, title and feed component. `Query.InfiniteService` with a scoped observer and stable scrobble IDs; `$.loadMore("feed")` if declared as an infinite query. Keep track links and the independently scrolling panel.                                                    |
| `/user/:username`  | [Public profile route](../app/app/routes/app/user.tsx) distinguishes private vs not found, shows the settings link only to the owner, offers Spotify sign-in to signed-out viewers, and redirects a signed-in, not-onboarded viewer. [History](../app/app/components/user-track-list.tsx) is a separate scroll surface. | Typed string username with keyed profile component, session-aware profile/current-user queries, kit Avatar plus HTML cards, and an explicit history child. Do not apply the Settings guard to the public profile.                                                                        |
| `/settings`        | [Guard](../app/app/routes/app/layout.tsx) requests Spotify sign-in if needed; non-onboarded users go to `/onboard`. [Settings](../app/app/routes/app/settings.tsx) shows profile/back link, reveal/hide email, sign-out, privacy, theme, import, and connected apps.                                                    | Guarded route with pending state. Kit Avatar, Button, Switch, Select and Dialog plus app-specific settings rows. Put sign-out, privacy save, file upload, revoke, and clipboard in commands.                                                                                             |
| `/onboard`         | [Loader and form](../app/app/routes/onboard.tsx) require auth, bypass the form for onboarded users, validate name and username, refresh current user after save, and navigate to a [sanitized same-origin return path](../app/app/lib/auth-return.ts).                                                                  | Typed search field for `returnTo` plus the existing return-path validation (a string Schema is not a same-origin check). Kit form and controlled fields, typed submit and then internal navigation.                                                                                      |
| `/auth/error`      | [Sign-in error](../app/app/routes/auth-error.tsx) reads `error` and `error_description`, truncates the optional untrusted description to 200 characters, and retries Spotify sign-in; a failed attempt releases pending state.                                                                                          | Optional search fields, render description as text, title via `Head`, sign-in command with recoverable failure.                                                                                                                                                                          |
| `/oauth/authorize` | [Consent page](../app/app/routes/oauth-authorize.tsx) uses a different card layout outside the notification shell. Auth/onboarding must preserve path and query; it fetches consent, shows invalid/expired requests, posts allow or deny with the original query, then follows the API's redirect in the browser.       | Separate route branch and layout; guard and query/command services. Preserve the original URL search string for the decision rather than reconstructing OAuth state from a partial typed route; retain server-side validation. Do not use internal router push for an external redirect. |
| Unmatched app URL  | [Root boundary](../app/app/root.tsx) presents a 404 or other error; diagnostic stack is development-only.                                                                                                                                                                                                               | Catch-all, explicit error views and per-route query/component fallbacks; don't let a transport or routing error turn into a blank screen.                                                                                                                                                |

## Cross-screen contracts

- **Session and notifications:** The [common layout](../app/app/routes/layout.tsx)
  puts [notifications](../app/app/components/notification-list.tsx) above the
  current page, except on consent. [The query](../app/app/hooks/use-notifications.ts)
  runs only with a session and hides cached results without one. Keep the
  [notification kind](../app/app/notifications/kinds.ts) dispatch and its
  acknowledgement-specific effects, not a generic auto-dismissing toast.
  [Sign-out](../app/app/hooks/use-sign-out.ts) clears query state and replaces
  the URL with `/feed`. Keep private queries session-scoped or otherwise
  guarantee eviction and disable inappropriate history restoration; apply this
  to current user, notifications, connected apps, and viewer-dependent
  profile/history results. Browser UI guards are not authorization.
- **Profile history:** [The timeline](../app/app/components/history-timeline.tsx)
  uses a fixed row height and a spacer for the full count. Keep
  [pure month/row addressing](../app/app/lib/history-timeline.ts) and
  immediate placeholders, sticky month heading, temporary thumb-side label,
  and settled month announcement. The [scroll hook](../app/app/hooks/use-settled-scroll.ts)
  measures the panel and fetches for the settled viewport (200 ms), not every
  crossed page. [Page keys](../app/app/hooks/use-history-pages.ts) include
  username, month key, count and page; requests use month boundary, offset and
  limit. Use declarative `queryMany` for the watched pages or a deliberately
  equivalent adapter, and account for already-cached pages outside the current
  watch set. Compare network request counts as well as rendered rows after
  dragging a long distance. Do not substitute the feed's cursor protocol.
- **Settings mutations:** [Privacy](../app/app/hooks/use-privacy-setting.ts)
  shows the requested value while pending and updates the current-user cache on
  success; preserve the previous value and failure message on failure.
  [Theme](../app/app/lib/theme.ts) preserves System/Light/Dark on reload.
  [Import](../app/app/hooks/use-import-upload.ts) uploads a CSV via multipart,
  refreshes latest status and [polls](../app/app/hooks/use-latest-import.ts)
  only while pending/processing; preserve pending/accepted/failure feedback.
  [Connected Apps](../app/app/components/settings/connected-apps-settings.tsx)
  lists and revokes authorizations, refetching after revoke; the
  [Connect an agent dialog](../app/app/components/settings/connect-agent-dialog.tsx)
  has copy success/failure and accessible dismissal. These belong in separate
  feature modules, not in the app's top-level update.
- **HTTP:** [The API adapter](../app/app/lib/api.ts) already builds typed
  `HttpApiClient` clients against `MyFmApi` with separate fetch layers for
  `credentials: "include"` and `"omit"`; its multipart import posts field
  `file` to `/api/import`. Prefer invoking those Effect-shaped operations at
  the UI adapter rather than routing them through a React-oriented Promise
  bridge. Keep [Better Auth](../app/app/lib/auth.ts) cookie credentials and
  [Spotify callback/error URLs](../app/app/lib/auth-guard.ts). A non-React
  Better Auth adapter still needs validation.
- **Worker dispatch:** [`app/api-paths.ts`](../app/api-paths.ts) defines
  API prefixes `/api/`, `/.well-known/oauth-` and exact paths `/health`,
  `/mcp`, `/token`, and `/register`. [The app Worker](../app/worker.ts)
  forwards those requests to the API binding and everything else to assets.
  [Alchemy](../alchemy.run.ts) uses `build/client`, the SPA fallback and
  `runWorkerFirst` for that same API list; [Vite dev proxy](../app/vite.config.ts)
  uses it too and preserves the Host for Spotify. Check direct loads and
  reloads of deep links without letting the SPA fallback swallow API requests.
- **Evidence:** Existing [route](../app/test/routes.test.ts),
  [return-path](../app/test/auth-return.test.ts),
  [history math](../app/test/history-timeline.test.ts) and
  [Worker](../app/test/worker.test.ts) tests are useful baselines. Coordinate
  request fixtures, stable clocks, identities and browser cases with the
  equivalence suite owner. Nothing in this inventory asserts parity.
