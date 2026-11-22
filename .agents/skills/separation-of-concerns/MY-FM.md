# Separation of concerns in my.fm

- **Worker:** The scheduled entry point in `effect-api/src/alchemy.ts` (and `effect-api/src/worker.ts`) runs the `Ingestion` and `Imports` Effect services. In `effect-api/src/ingestion/service.ts`, the ingestion service coordinates `Db` and `SpotifyClient`, while `shouldFetchUser` in `effect-api/src/ingestion/cadence.ts` decides from fetch state, time, and configuration supplied as inputs.
- **React:** In `app/app/`, `HistoryTimeline` renders the list, `useSettledScroll` owns browser scroll state, and `useHistoryPages` fetches pages. `lib/history-timeline.ts` maps rows to pages and formats dates without React.

my.fm only partly groups files by domain. Worker ingestion and frontend notifications each have a domain folder; the frontend history example still spans `components/`, `hooks/`, and `lib/`. Use those history files for the responsibility split, not as a folder template.
