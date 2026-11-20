---
name: frontend-separation
description: Separation of concerns. Use when a React view gains stateful behavior or when deciding where feature files belong.
---

# Separation of concerns

1. Place files by domain. Keep a feature's views, hooks, and pure rules together in separate files. For each changed file outside the domain, identify the router requirement or the other domains that share it.
2. Put fetching, mutations, effects, and observers in hooks. Put scroll and date math and state-machine transitions in plain modules. Check that each effect has a hook or router owner and each pure rule runs without mounting a view.
3. Read the component top to bottom. Every statement should prepare markup, choose a display state, or connect data and events to the view.

my.fm is partway there: `app/app/notifications/` groups renderers and kind definitions by domain. For responsibility boundaries, compare `useSettledScroll`, `useHistoryPages`, and `lib/history-timeline.ts` under `app/app/`; those files still live in folders grouped by file kind.
