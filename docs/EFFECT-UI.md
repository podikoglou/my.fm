# Effect UI migration reference

This is a source reference for a **new my.fm browser frontend**, not a plan to
embed Effect UI inside React. Keep the existing API Worker, D1, Spotify and
Better Auth contracts. Use the [screen inventory](EFFECT-UI-SCREENS.md) and the
separately owned equivalence suite to compare the two frontends before cutover.

## Pin and install

The [official site](https://ui.effect.website/) links to
[Effect-TS/ui](https://github.com/Effect-TS/ui), and the repository README identifies
`examples/launch` as the source of that site. There were no Git tags or GitHub
releases when researched. The verified default-branch revision is
[`1ba208776ee27c98dfa9e724e30e050309d9648e`][pin], snapshot suffix `1ba2087`.
Clone outside the my.fm workspace:

```sh
git clone https://github.com/Effect-TS/ui.git ../effect-ui
git -C ../effect-ui switch --detach 1ba208776ee27c98dfa9e724e30e050309d9648e
```

The public npm registry had none of these packages. At this pin, the
[upstream snapshot workflow][snapshot] publishes these tarballs; all four
tarball manifests were checked:

| Package               | Version | Role                                                 |
| --------------------- | ------- | ---------------------------------------------------- |
| `@effect/ui`          | `0.0.0` | Core, HTML host/router, and testing APIs             |
| `@effect/ui-kit`      | `0.0.0` | Unstyled HTML controls and behaviors                 |
| `@effect/ui-devtools` | `0.0.0` | Optional debugging; not required for the browser app |
| `@effect/ui-opentui`  | `0.0.0` | OpenTUI terminal host; not needed for my.fm          |

The [rebuild foundation][foundation] added `effect-app/` to the root Bun workspaces and
declared this dependency in `effect-app/package.json`:

```json
{
  "dependencies": {
    "@effect/ui": "https://pkg.pr.new/Effect-TS/ui/@effect/ui@1ba208776ee27c98dfa9e724e30e050309d9648e"
  }
}
```

From the my.fm workspace root:

```sh
bun install
bun run --cwd effect-app typecheck
bun run --cwd effect-app build
```

**Verified by the rebuild foundation owner:** Bun installed `@effect/ui`
with my.fm's Effect `4.1.5` (`Resolved, downloaded and extracted [44]`,
`Saved lockfile`,
`49 packages installed [1490.00ms]`). The resulting `bun.lock` pinned
`@effect/ui` to the full SHA above and contained one `effect` package entry
at `4.1.5`. Typecheck and the Vite `7.3.2` production build passed
(829 modules transformed).

**Not verified:** whether the built app uses a single Effect instance at
runtime, and whether it works in a browser. One lockfile entry establishes
package resolution, not bundle or runtime identity. The feed/shell
foundation did not need or install `@effect/ui-kit`. When adding the kit,
declare its matching snapshot URL
(`https://pkg.pr.new/Effect-TS/ui/@effect/ui-kit@1ba208776ee27c98dfa9e724e30e050309d9648e`)
and verify its installation and browser behavior separately. Use the same
SHA for all UI packages. Both core and kit declare `effect: ^4.1.4`,
while upstream develops against `^4.1.6`; do not upgrade the workspace
solely to match upstream development.
Enable both `strict` and `exactOptionalPropertyTypes` for the rebuilt app;
upstream documents an inference failure when the latter is off.

## Component model and runtime

Core types are exported from `@effect/ui`, DOM builders, commands and host
from `@effect/ui/html`. The following are simplified call signatures; use the
linked declarations for overloads and inferred requirements.

| API                                                         | Contract and use                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`Html.component`][html] / [`Component.define`][component]  | `Html.component({ name, props?, model, message?, events?, queries? }).make({ init, update, view, ... })` binds the core component definition to HTML elements. Use `Schema.Struct` for data and [`UiSchema.TaggedEnum`][uischema] for message and event constructors (as in [Counter][counter]).                                                                                                                                                                                                  |
| [Lifecycle and render context][component]                   | `init($)` seeds the Model; `update: { Tag: ($, payload) => ... }` handles messages; `view(h, model)` describes output. `$.evolve({ field: valueOrUpdater })` changes fields, `$.run(issued)` asks the runtime to perform work, and `$.emit(event)` reports to a parent. Chain them when one transition needs several actions. Prop changes dispatch no message; use current props, a re-key for a fresh instance, or a dependency-keyed subscription to restart work without resetting the Model. |
| [Child calls][component] / [view helpers][views]            | `Child(h, { key?, props?, onEmit?, fallback? })` declares a child. Parents pass props; child events map to parent messages, not direct child dispatch. Stable keys preserve child instances; siblings of the same component need distinct keys. Use DOM builder keys separately for repeated elements. Unmount ends the instance; use `h.keepAlive` to keep it live while not drawn, or deliberate history restoration to restore saved Models on navigation.                                     |
| [`Command.make` / `Command.Service`][command]               | `Command.make(name, { args, ... }, args => effect)` defines local work; `Command.Service<Self>()(name, options)` declares a service contract, implemented by `toLayer`. Issue `$.run(Cmd.make(args))`; map typed service outcomes back to messages with `Command.match`, or use `Command.asNoop` for an intentionally silent outcome. [Counter][counter] uses `h.isRunning(Cmd)` for pending UI.                                                                                                  |
| [`Subscription.make`][subscription] / [`Mount.make`][mount] | `Subscription.make(name, stream)` or `Subscription.make(name, deps, build)` delivers messages while listed by `subscriptions({ model, ... })`. For element-specific work, `Mount.make(name, options, (node, args, changes) => effect)` reports once; use `Mount.makeStream` to report repeatedly for the element's lifetime, e.g. from a sentinel observer. Use the typed helpers in [`HtmlSubscription`][html-sub] and [`HtmlCommand`][html-cmd] before inventing browser adapters.              |
| [`BrowserHost.mount`][browser-host]                         | `mount(component, propsOrEffect, container, options?): Layer`. Give it an existing DOM element, provide the router and other service Layers, and launch with `Layer.launch(Main).pipe(Effect.runFork)` (see [routing entry][routing-main]). Use `mountEffect` only if the caller needs the root handle.                                                                                                                                                                                           |

Keep domain rules pure (history addressing, return-path validation, theme
choices), commands and subscriptions at lifecycle boundaries, and API/network
implementations in injected Layers. Parse untrusted values once at the edge.
A small view function is enough for a card or icon; create a component when it
owns a lifecycle, state or effects. Shared shell state (session, notifications)
needs one explicit owner; do not mirror the same data in each page Model.
Upstream also provides [`Feature`][feature] for Layer-supplied implementations;
do not make simple screens feature services by default.

## Routing, navigation and state restoration

- [`Route.make(path, { params?, search? })`][route] requires a Schema for
  each named path parameter. `Route.union({ Tag: route, ... }, ...redirects)`
  provides constructors, `match`, `parse(url): Option<RouteValue>` and
  `print(route): string`. `Route.redirect(path, (params, search) => route)`
  is for unconditional redirects, not async session checks. Include a
  `Route.make("/*")` fallback; required invalid search can resolve to 404
  ([route tests][route-test]).
- Provide `BrowserRouter.layer({ routes })`; initialize the root with
  `Router.props(routes)` or read `Router.currentRoute(routes)` in effectful
  root props. `Router.subscription(routes, model.route, toMessage)` drives
  subsequent URL changes through `update`. Use `routes.match` in the view to
  place the right page in its shell; there is no React Router file route,
  loader, nested outlet or generated route-props dependency in this pattern.
  Use typed `h.a.attr("href", routes.print(route))` for internal links,
  `Router.push(routes, route)` or `Router.replace(routes, route)` for
  imperative internal navigation; use an actual browser navigation for the
  server-provided OAuth redirect. Use `head: (...) => [Head.title(...)]`
  for per-screen titles; [`HtmlHead`][html-head] supplies HTML-specific metadata.
  See [`Router.ts`][router], [browser routing][browser-router],
  and the [routing][routing] and [auth][auth] examples.
- The auth example's guard models logged-in/out routing and uses Layer-backed
  session services; its storage implementation is **not** my.fm's cookie
  session. Express my.fm's async guards as pending/allowed/redirect/error
  decisions in the UI and keep API-side authorization unchanged.
- BrowserRouter has link interception, document scroll, focus, announcements,
  and back/forward handling. Its window scroll behavior does not establish
  parity for my.fm's independently scrolling feed/history panels.

### Keep auth-bound state out of browser history

When leaving an entry, the [Router][router] snapshots component Models
**and query results** and can write them to `history.state`. A session
render guard or sign-out cache clear does not erase earlier snapshots.
Set `Html.component({ ..., restore: false })` on **each component whose
Model or queries hold data tied to the signed-in user or viewer**.
At the pin, [`stateRestore.ts`][state-restore] skips both saving and reading
that component's snapshot, including old saved state. The opt-out does not
propagate to children or erase existing history entries. A `restore`
function that only clears Model fields leaves query results eligible to save.

Apply this to the shared session/current-user and notification owners,
`/settings` (account, privacy, imports and connected apps), viewer-dependent
`/user/:username` profile and history results, the `/onboard` form, and
`/oauth/authorize` consent state. The anonymous feed does not need this
opt-out for its public results. See the
[NotificationList fix][notification-restore] for an example.

Keep live query eviction or session scoping on sign-out as well: history
opt-out neither clears the live cache nor controls server hydration.
See the [upstream history and redaction guidance][llms] for those limits.
Test navigation and then sign-out followed by Back: newly saved entries
should contain no auth-bound snapshots, and the UI must not show data
from the previous viewer.

## Queries, commands and forms

- [`Query.Service<Self>()(name, options)`][query] takes `args`, `success`,
  `error`, `staleTime`, and optionally `refetchInterval`, `idleTimeToLive`
  and tags. `Service.toLayer(fetcher)` provides an Effect fetcher. Declarative
  component `queries: { alias: { query: Service, args: ({ model, props }) => ... } }`
  watches an entry (return `undefined` from `args` to disable); read
  `h.queries.alias` as `AsyncResult`, including success while refetching.
  [Launch's Posts demo][posts] shows debounced args and `Component.provide`.
  `get(args)` waits for a fresh result, `peek(args)` reads the cache without
  loading, `prefetch(args)` starts a fetch, and `invalidate(args?)` marks
  one entry or all entries stale. Retries, if required, live in the fetcher.
- `Query.InfiniteService<Self>()(name, options)` declares `page`, `cursor`,
  `items(page)`, `key(item)`, and `next(lastPage, allPages): Option<Cursor>`
  in addition to the common options. Its fetcher takes `(args, Option<Cursor>)`.
  `loadMore(args)` returns the held pages and whether there is a next page;
  `items(pages)` deduplicates by key. Preserve the feed's opaque cursor and
  termination/error behavior; compare deduplication with the baseline before
  using `items`. See [infinite query tests][infinite-tests]. Profile history
  is **not** an infinite cursor feed: its pages are addressed by month and
  offset, with separate month counts and placeholders.
- Replace React Query mutations with service Commands. [`Command.Service`][command]
  supports query invalidation targets; write a typed success/failure path and
  check whether to invalidate, update cache data, or retain the last known
  result rather than assuming equivalence with React Query. For import status,
  `refetchInterval` can be result-dependent on a watched entry; keep the
  existing 15-second interval only while pending/processing. At the adapter,
  preserve cookie-bearing requests, explicit anonymous feed requests, and
  recognizable API errors; don't wrap typed private-profile errors into a
  generic one before the UI can branch on them.
- Replace React Hook Form with controlled values, [`Validation.make(fields,
options?)`][validation] and UI-kit [`Form`][form], [`Field`][field],
  and [`Input`][input]. Use the form's state operations `change`, `blur`,
  `submit` and `reject`; derive validity with `validate(state)` and only run
  the submit Command when there is a valid value. `Form` emits
  `Submitted({ fields, entries })` and focuses the first invalid control;
  `Field` coordinates label, error, and ARIA. Reuse the API's `OnboardInput`
  schema at the submit boundary rather than inventing conflicting username
  rules. See [upstream forms docs][upstream-forms] and [DOM tests][form-tests].
- Upload needs the actual browser `File`, not a serialized path or text.
  Use [`HtmlFiles`][files], a native file input, or kit `FileDrop` if matching
  the baseline interaction; pass the `File` to the upload Command without
  persisting it in restorable state.

## UI kit and styling

The [kit README][kit] and [public barrel][kit-index] are the catalog of record.
Controls are unstyled, and their **parts take the app's HTML builders**. For
headless components, call e.g. `Checkbox(h, { props, onEmit, view })` and use
`checkbox.root(h.button.class(...))`; check each part's required native tag.
Stateless wrappers such as `Button`, `Input` and `Switch` use individual
event options rather than component `onEmit`. Inspect each control's emitted
events, ARIA, keyboard behavior and documented `data-*` style hooks; a matching
name does not mean Base UI's props or selector contract matches.

| Area                      | Modules and components at the pin                                                                                                               |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Forms and input           | Button, Input, Field, Fieldset, Form, Checkbox, CheckboxGroup, RadioGroup, Switch, Toggle, ToggleGroup, Slider, NumberField, OTPField, FileDrop |
| Dates and choice          | Calendar, RangeCalendar, DateField, DatePicker, Select, Combobox, Autocomplete                                                                  |
| Navigation and disclosure | Accordion, Collapsible, Tabs, NavigationMenu, Menu, Menubar, ContextMenu, Toolbar                                                               |
| Overlays                  | Dialog, AlertDialog, Drawer, DrawerProvider, Popover, PreviewCard, Tooltip, ToastProvider (Toast module)                                        |
| Display and scrolling     | Avatar, Progress, Meter, Separator, ScrollArea, VirtualList                                                                                     |
| Shared behavior           | DirectionProvider, ListNavigation, Positioning, Typeahead, VirtualKeyboard                                                                      |

For my.fm use kit primitives for control behavior, not as replacements for
the app's cards, badges, skeletons, headings, icons, settings rows or
persistent notification list. Build those with semantic HTML plus current
Tailwind utilities and CSS tokens. The launch site uses Tailwind in
[Vite][launch-vite] and emits classes from TypeScript builders. Keep classes
statically discoverable or explicitly register sources; verify on the
production build. Keep `app.css` tokens and run the existing
`my.fm:theme` bootstrap before paint; use an Effect UI command for changes
that mutate the document or storage. Use explicit markup or browser-safe icon
assets instead of importing `lucide-react` into an HTML view.

The kit defaults popups to the browser top layer. The components that
document `topLayer: false` then render in place, non-modal and subject to
clipping; that is not a blanket replacement for React portals. Verify dialog
focus return, Escape, keyboard selection, and visual layering for Settings.
[`VirtualList`][virtual] can measure and virtualize rows but its end-to-end
fit for my.fm's fixed-height timeline, month indicators, and settled
viewport paging is **unverified**; preserve the pure timeline logic before
changing scroll behavior.

## Build, tests, and risks

- **Start with a Vite client SPA.** Use an explicit HTML shell and TypeScript
  browser entry, keep `@tailwindcss/vite`, replace the React Router Vite
  plugin/typegen, and produce `build/client` or coordinate a matching change
  to the Alchemy output directory. Keep same-origin dev proxy paths, fixed
  dev port/allowed host and the forwarded Host used by Spotify. Verify the
  Worker rather than assuming Vite's dev fallback proves deployment behavior.
- **Launch is a reference, not a build template.** Its [Vite config][launch-vite]
  also assembles Markdown, code excerpts and build-time HTML. [Prerender][prerender]
  uses `HtmlServer.renderToHtml(LaunchPage, props, { static: true })` and
  `HtmlServer.serializeState(state)`; the [browser entry][launch-main] uses
  `HtmlHydrate.hydrate` when serialized state exists and `BrowserHost.mount`
  otherwise. That demonstrates both entry paths, not a reason to introduce
  SSR, islands, hydration, or personalized server-rendered state for my.fm.
- **Pick the right tests.** [Counter Story][story] checks pure message/Model
  behavior; [Scene][scene] exercises component wiring and controlled effects;
  [Play][play] mounts under the upstream test host and exercises rendered
  interaction with locator and Effect clock support (`HtmlScene`, `HtmlPlay`
  and `HtmlLocator` from `@effect/ui/html/testing`; `TestHost` and
  `Story` from `@effect/ui/testing`). [Kit document tests][form-tests]
  and [BrowserRouter tests][router-tests] cover DOM and history behaviors.
  These files were read as examples, not run here. They are not evidence of
  my.fm equivalence: use the separate suite against the old/new frontends,
  including real-browser focus, file selection, scroll, native history and
  OAuth navigation, plus Worker routing and request traces.
- **Explicit review gates.** The upstream APIs are experimental, package
  snapshots are not npm releases, and the foundation build does not verify
  browser behavior, Better Auth's non-React client, Cloudflare's static site,
  or browser support for every kit control in my.fm. The current
  [code style](CODE-STYLE.md) limits Effect outside infrastructure; the new
  UI framework requires it within the browser runtime. Scope that exception
  to the rebuild and review any necessary lint/TS config change; do not
  blanket-disable rules or port unrelated API/domain code to Effect.

[pin]: https://github.com/Effect-TS/ui/commit/1ba208776ee27c98dfa9e724e30e050309d9648e
[foundation]: https://github.com/podikoglou/my.fm/commit/993a175468603713d8fb59a1cb88f3eb1b58f092
[snapshot]: https://github.com/Effect-TS/ui/blob/1ba208776ee27c98dfa9e724e30e050309d9648e/.github/workflows/snapshot.yml
[html]: https://github.com/Effect-TS/ui/blob/1ba208776ee27c98dfa9e724e30e050309d9648e/packages/ui/src/html/Html.ts
[component]: https://github.com/Effect-TS/ui/blob/1ba208776ee27c98dfa9e724e30e050309d9648e/packages/ui/src/Component.ts
[uischema]: https://github.com/Effect-TS/ui/blob/1ba208776ee27c98dfa9e724e30e050309d9648e/packages/ui/src/UiSchema.ts
[counter]: https://github.com/Effect-TS/ui/blob/1ba208776ee27c98dfa9e724e30e050309d9648e/examples/launch/src/autocounter/Counter.ts
[views]: https://github.com/Effect-TS/ui/blob/1ba208776ee27c98dfa9e724e30e050309d9648e/packages/ui/src/View.ts
[command]: https://github.com/Effect-TS/ui/blob/1ba208776ee27c98dfa9e724e30e050309d9648e/packages/ui/src/Command.ts
[subscription]: https://github.com/Effect-TS/ui/blob/1ba208776ee27c98dfa9e724e30e050309d9648e/packages/ui/src/Subscription.ts
[mount]: https://github.com/Effect-TS/ui/blob/1ba208776ee27c98dfa9e724e30e050309d9648e/packages/ui/src/Mount.ts
[html-sub]: https://github.com/Effect-TS/ui/blob/1ba208776ee27c98dfa9e724e30e050309d9648e/packages/ui/src/html/HtmlSubscription.ts
[html-cmd]: https://github.com/Effect-TS/ui/blob/1ba208776ee27c98dfa9e724e30e050309d9648e/packages/ui/src/html/HtmlCommand.ts
[html-head]: https://github.com/Effect-TS/ui/blob/1ba208776ee27c98dfa9e724e30e050309d9648e/packages/ui/src/html/HtmlHead.ts
[browser-host]: https://github.com/Effect-TS/ui/blob/1ba208776ee27c98dfa9e724e30e050309d9648e/packages/ui/src/html/BrowserHost.ts
[routing-main]: https://github.com/Effect-TS/ui/blob/1ba208776ee27c98dfa9e724e30e050309d9648e/examples/routing/src/main.ts
[feature]: https://github.com/Effect-TS/ui/blob/1ba208776ee27c98dfa9e724e30e050309d9648e/packages/ui/src/Feature.ts
[route]: https://github.com/Effect-TS/ui/blob/1ba208776ee27c98dfa9e724e30e050309d9648e/packages/ui/src/Route.ts
[route-test]: https://github.com/Effect-TS/ui/blob/1ba208776ee27c98dfa9e724e30e050309d9648e/packages/ui/test/Route.test.ts
[router]: https://github.com/Effect-TS/ui/blob/1ba208776ee27c98dfa9e724e30e050309d9648e/packages/ui/src/Router.ts
[state-restore]: https://github.com/Effect-TS/ui/blob/1ba208776ee27c98dfa9e724e30e050309d9648e/packages/ui/src/internal/stateRestore.ts
[notification-restore]: https://github.com/podikoglou/my.fm/commit/d930284c7f3dce41de9cdaa383c04d8f82a4647f
[browser-router]: https://github.com/Effect-TS/ui/blob/1ba208776ee27c98dfa9e724e30e050309d9648e/packages/ui/src/html/BrowserRouter.ts
[routing]: https://github.com/Effect-TS/ui/blob/1ba208776ee27c98dfa9e724e30e050309d9648e/examples/routing/src/App.ts
[auth]: https://github.com/Effect-TS/ui/blob/1ba208776ee27c98dfa9e724e30e050309d9648e/examples/auth/src/App.ts
[llms]: https://github.com/Effect-TS/ui/blob/1ba208776ee27c98dfa9e724e30e050309d9648e/LLMS.md#history-restore
[query]: https://github.com/Effect-TS/ui/blob/1ba208776ee27c98dfa9e724e30e050309d9648e/packages/ui/src/Query.ts
[posts]: https://github.com/Effect-TS/ui/blob/1ba208776ee27c98dfa9e724e30e050309d9648e/examples/launch/src/queries/effect/Posts.ts
[infinite-tests]: https://github.com/Effect-TS/ui/blob/1ba208776ee27c98dfa9e724e30e050309d9648e/packages/ui/test/InfiniteData.test.ts
[validation]: https://github.com/Effect-TS/ui/blob/1ba208776ee27c98dfa9e724e30e050309d9648e/packages/ui/src/Validation.ts
[form]: https://github.com/Effect-TS/ui/blob/1ba208776ee27c98dfa9e724e30e050309d9648e/packages/ui-kit/src/Form.ts
[field]: https://github.com/Effect-TS/ui/blob/1ba208776ee27c98dfa9e724e30e050309d9648e/packages/ui-kit/src/Field.ts
[input]: https://github.com/Effect-TS/ui/blob/1ba208776ee27c98dfa9e724e30e050309d9648e/packages/ui-kit/src/Input.ts
[upstream-forms]: https://github.com/Effect-TS/ui/blob/1ba208776ee27c98dfa9e724e30e050309d9648e/ai-docs/src/10_ui/26_forms.ts
[form-tests]: https://github.com/Effect-TS/ui/blob/1ba208776ee27c98dfa9e724e30e050309d9648e/packages/ui-kit/test/FormDocument.test.ts
[files]: https://github.com/Effect-TS/ui/blob/1ba208776ee27c98dfa9e724e30e050309d9648e/packages/ui/src/html/HtmlFiles.ts
[kit]: https://github.com/Effect-TS/ui/blob/1ba208776ee27c98dfa9e724e30e050309d9648e/packages/ui-kit/README.md
[kit-index]: https://github.com/Effect-TS/ui/blob/1ba208776ee27c98dfa9e724e30e050309d9648e/packages/ui-kit/src/index.ts
[launch-vite]: https://github.com/Effect-TS/ui/blob/1ba208776ee27c98dfa9e724e30e050309d9648e/examples/launch/vite.config.ts
[virtual]: https://github.com/Effect-TS/ui/blob/1ba208776ee27c98dfa9e724e30e050309d9648e/packages/ui-kit/src/VirtualList.ts
[prerender]: https://github.com/Effect-TS/ui/blob/1ba208776ee27c98dfa9e724e30e050309d9648e/examples/launch/src/prerender.ts
[launch-main]: https://github.com/Effect-TS/ui/blob/1ba208776ee27c98dfa9e724e30e050309d9648e/examples/launch/src/main.ts
[story]: https://github.com/Effect-TS/ui/blob/1ba208776ee27c98dfa9e724e30e050309d9648e/examples/launch/src/autocounter/Counter.story.test.ts
[scene]: https://github.com/Effect-TS/ui/blob/1ba208776ee27c98dfa9e724e30e050309d9648e/examples/launch/src/autocounter/Counter.scene.test.ts
[play]: https://github.com/Effect-TS/ui/blob/1ba208776ee27c98dfa9e724e30e050309d9648e/examples/launch/src/autocounter/Counter.play.test.ts
[router-tests]: https://github.com/Effect-TS/ui/blob/1ba208776ee27c98dfa9e724e30e050309d9648e/packages/ui/test/html/BrowserRouter.test.ts
