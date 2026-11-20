# Separation of concerns in my.fm

- **Worker:** The scheduled entry point in `worker-api/src/worker.ts` passes the scheduled time to `runIngestion` and delegates import ingestion. In `worker-api/src/ingestion/run.ts`, the ingestion flow reads from storage and calls Spotify; `shouldFetchUser` decides from fetch state, time, and configuration supplied as inputs.
- **React:** In `app/app/`, `HistoryTimeline` renders the list, `useSettledScroll` owns browser scroll state, and `useHistoryPages` fetches pages. `lib/history-timeline.ts` maps rows to pages and formats dates without React.

my.fm only partly groups files by domain. Worker ingestion and frontend notifications each have a domain folder; the frontend history example still spans `components/`, `hooks/`, and `lib/`. Use those history files for the responsibility split, not as a folder template.
