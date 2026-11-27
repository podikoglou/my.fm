import { Effect, Schema } from "effect";

import type { Scrobble } from "../db/schema.ts";

import { InvalidCursorError } from "./errors.ts";

const CURSOR_VERSION = 1;

export interface CursorPageInput {
  readonly cursor?: string;
  readonly limit: number;
}

export interface CursorWindow {
  readonly after: { readonly seconds: number; readonly id: Scrobble["id"] } | undefined;
  readonly limit: number;
}

export interface ScrobblePage<A> {
  readonly items: A[];
  readonly nextCursor: string | null;
}

const CursorPayloadSchema = Schema.Tuple([
  Schema.Literal(CURSOR_VERSION),
  Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  Schema.String.check(Schema.isPattern(/^[0-9a-f]{32}$/)),
]);

const decodeCursorPayload = Schema.decodeUnknownSync(CursorPayloadSchema);

function encodeCursor(id: Scrobble["id"], scrobbleDate: Date): string {
  const seconds = Math.floor(scrobbleDate.getTime() / 1000);
  const bytes = btoa(JSON.stringify([CURSOR_VERSION, seconds, id]));

  return bytes.replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function decodeCursor(value: string) {
  return Effect.try({
    try: () => {
      const base64 = value.replaceAll("-", "+").replaceAll("_", "/");
      const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
      const parsed = decodeCursorPayload(JSON.parse(atob(padded)));

      return { seconds: parsed[1], id: parsed[2] };
    },
    catch: () => new InvalidCursorError({ message: "Invalid cursor" }),
  });
}

export function readScrobblePage<A extends Pick<Scrobble, "id" | "scrobbleDate">, E, R>(
  { cursor, limit }: CursorPageInput,
  read: (window: CursorWindow) => Effect.Effect<ReadonlyArray<A>, E, R>,
): Effect.Effect<ScrobblePage<A>, InvalidCursorError | E, R> {
  return Effect.gen(function* () {
    const after = cursor === undefined ? undefined : yield* decodeCursor(cursor);
    const rows = yield* read({ after, limit: limit + 1 });
    const items = rows.slice(0, limit);
    const last = items.at(-1);

    const nextCursor =
      rows.length > limit && last?.scrobbleDate ? encodeCursor(last.id, last.scrobbleDate) : null;

    return { items, nextCursor };
  });
}
