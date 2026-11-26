# Application parity

Run the same Playwright tests against the original React app or the Effect UI
rebuild. No API Worker, credentials, or live Spotify connection are needed.

```sh
bun install
bun run --cwd parity playwright install chromium
bun run --cwd parity test:current
bun run --cwd parity test:next
```

The defaults start `app/` at `http://localhost:5173` for current and
`effect-app/` at `http://localhost:5174` for next. Set `PARITY_BASE_URL` or
`PARITY_NEXT_URL` to use an already-running app. Set `PARITY_COMMAND` to start
it with a different command, executed from the workspace root. The rebuilt app
must serve the same browser routes and call the HTTP API on its own origin under
`/api/`; browser requests are served by the test fixtures.

| Browser route      | Flows and states                                                                                                                                            |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/` → `/feed`      | Public redirect, populated/empty/unavailable feed, cursor pagination, profile and Spotify links                                                             |
| `/user/:username`  | Public/owner/private/missing profiles, populated/empty/unavailable history, scrolling across pages, owner settings and notification dismissal               |
| `/settings`        | Sign-in and onboarding guards, profile back link, email reveal/hide, privacy, light/dark settings, CSV upload, agent instructions, app revocation, sign-out |
| `/onboard`         | Incomplete-account form, validation, submission, and return path                                                                                            |
| `/oauth/authorize` | Consent, expired request, allow/deny and callback, onboarding guard and return path                                                                         |
| `/auth/error`      | Spotify error details and retry                                                                                                                             |
| Unmatched paths    | Not-found page                                                                                                                                              |

The browser clock, locale, timezone, and viewports are fixed. External network
requests (including remote fonts) are blocked; album art and outgoing OAuth
destinations are stubbed.

Both targets compare desktop and mobile screenshots against the same files in
`baselines/`. Use the pinned Chromium version and the same Linux font setup
when comparing images. `PARITY_MAX_DIFF_RATIO` defaults to `0`; set it to a
number between `0` and `1` to allow a fraction of pixels to differ. On failure,
Playwright writes actual and diff images to `test-results/`.

Only the original app can regenerate the baselines:

```sh
bun run --cwd parity baselines:update
```

Review the changed images before committing them. Do not regenerate baselines
to make rebuild differences pass. Keep the original app available alongside
the rebuild while both are being compared.
