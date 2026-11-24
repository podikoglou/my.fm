import { Effect, Schema } from "effect";

import type { FeedCursor, FeedItem } from "../db/queries/scrobbles.ts";

import { InvalidCursorError } from "./errors.ts";

const CURSOR_VERSION = 1;

const CursorPayloadSchema = Schema.Tuple([
  Schema.Literal(CURSOR_VERSION),
  Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  Schema.String.check(Schema.isPattern(/^[0-9a-f]{32}$/)),
]);

const decodeCursorPayload = Schema.decodeUnknownSync(CursorPayloadSchema);

export function encodeFeedCursor(row: Pick<FeedItem, "id" | "scrobbleDate">): string {
  const seconds = Math.floor(row.scrobbleDate.getTime() / 1000);
  const bytes = btoa(JSON.stringify([CURSOR_VERSION, seconds, row.id]));

  return bytes.replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

export function decodeFeedCursor(value: string): Effect.Effect<FeedCursor, InvalidCursorError> {
  return Effect.try({
    try: () => {
      const base64 = value.replaceAll("-", "+").replaceAll("_", "/");
      const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
      const parsed = decodeCursorPayload(JSON.parse(atob(padded)));

      return { scrobbleDate: new Date(parsed[1] * 1000), id: parsed[2] };
    },
    catch: () => new InvalidCursorError({ message: "Invalid cursor" }),
  });
}
