import { vi } from "vitest";

import type { IngestionEventFields } from "../src/ingestion/events.ts";

/**
 * Capture the ingestion log output and keep it out of the test output.
 *
 * Normal events are one object; failures are an event name followed by an
 * optional detail.
 */
export function captureLogs() {
  const events: IngestionEventFields[] = [];
  const messages: unknown[][] = [];

  const recordEvent = (fields: IngestionEventFields) => {
    events.push(fields);
  };

  const recordMessage = (...args: unknown[]) => {
    messages.push(args);
  };

  const spies = [
    vi.spyOn(console, "log").mockImplementation(recordEvent),
    vi.spyOn(console, "warn").mockImplementation(recordMessage),
    vi.spyOn(console, "error").mockImplementation(recordMessage),
  ];

  return {
    events,
    messages,
    named: (event: string) => events.filter((entry) => entry.event === event),
    restore: () => {
      for (const spy of spies) {
        spy.mockRestore();
      }
    },
  };
}
