---
name: frontend-separation
description: Use when building or reviewing React routes, components, stateful interactions, or feature file layout. Separate rendering from behavior and organize files by domain.
---

# Frontend separation

**Why:** Looking right isn't enough. A component should be easy to read as markup, and its behavior should be possible to understand without mounting the view. A change to one domain should be easy to find without hunting through several folders sorted by file kind.

## Rules

1. Keep components small and focused on rendering. Accept data and actions, compose primitives, and choose the right markup for the current state. Calling a hook, mapping data to elements, and binding an event handler are rendering work; implementing an upload or pagination flow in the component isn't.
2. Put fetching, mutations, effects, browser observers, and other React-bound stateful logic in hooks. Expose what the view needs to render and the actions it can call. Don't invent a hook for a class name or a JSX conditional.
3. Put scroll and date calculations, data transformation, and transition logic that doesn't need React in plain modules. Put the state machine's rules there too when they're independent of React; let the hook connect those rules to the component lifecycle.
4. Group files by the domain or feature they serve. Keep a feature's views, hooks, and pure rules near each other in separate files. Keep genuinely shared primitives and helpers shared, and leave route metadata, loaders, and redirects where the router expects them. Prefer moving toward this layout in the files you touch over reorganizing unrelated code.

## my.fm examples

my.fm only partly follows this layout. Its notification renderers and kind definitions sit together in `app/app/notifications/`, while listening-history files still span `components/`, `hooks/`, and `lib/`. Read the examples as responsibility boundaries, not a folder template.

| Do | Don't |
| --- | --- |
| Call `useImportUpload` from Settings so the view renders the input, messages, and submit state. The hook owns the file selection, mutation, input reset, and query invalidation (`app/app/hooks/use-import-upload.ts`). | Put the upload request, file reset, and cache refresh directly in the component because they all came from one feature. |
| Use `useSettledScroll` for scroll state, `useHistoryPages` for fetching pages, and `lib/history-timeline.ts` for row-to-page mapping and date formatting. Test the calculations in `app/test/history-timeline.test.ts` without rendering the timeline. | Add the next observer, paging rule, or date calculation to `HistoryTimeline` just because it composes the results. `FeedTrackList` still owns its fetch and observer; use it as an example of what to extract, not what to copy. |

## Pre-PR checklist

- [ ] I can skim the component to see what it renders without reading a workflow first.
- [ ] Fetches, effects, and state transitions live outside the render component.
- [ ] Pure rules can be tested without React, and each layer exposes only what its callers need.
- [ ] Feature files live with their domain unless genuinely shared or required elsewhere by the framework.
