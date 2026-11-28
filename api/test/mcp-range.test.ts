import { env } from "cloudflare:workers";
import { Effect, Layer, Schema } from "effect";
import { expect, test, vi } from "vitest";

import { McpService } from "../src/mcp/service.ts";
import { Scrobbles } from "../src/scrobbles/service.ts";
import { Stats } from "../src/stats/service.ts";
import { calendarRangeBounds } from "../src/time-zone.ts";
import { Users } from "../src/users/service.ts";
import { makeWorkerInfraLayer } from "../src/worker.ts";
import { insertRows } from "./d1.ts";

test("counts local dates across a spring clock change and a month boundary", () => {
  const now = Date.parse("2026-03-31T21:30:00Z");

  const cases = [
    ["yesterday", "2026-03-30T21:00:00Z", "2026-03-31T21:00:00Z"],
    ["last_7_days", "2026-03-25T22:00:00Z", "2026-04-01T21:00:00Z"],
    ["this_month", "2026-03-31T21:00:00Z", "2026-04-30T21:00:00Z"],
  ] as const;

  for (const [range, since, until] of cases) {
    expect(calendarRangeBounds(range, "Europe/Athens", now)).toEqual({
      since: Date.parse(since) / 1000,
      until: Date.parse(until) / 1000,
    });
  }
});

test("keeps the first page's local day when a cursor crosses midnight", async () => {
  const userId = "V1StGXR8_Z5jdHi6B-myT";
  await insertRows(env.DB, "users", {
    id: userId,
    username: "calendar",
    name: "Calendar",
    email: "calendar@example.com",
    updatedAt: new Date(),
    onboarded: true,
  });
  await insertRows(
    env.DB,
    "scrobbles",
    ["2026-10-24T20:59:59Z", "2026-10-24T21:00:00Z", "2026-10-25T21:59:58Z"].map(
      (timestamp, index) => ({
        id: index.toString(16).padStart(32, "0"),
        userId,
        scrobbleDate: new Date(timestamp),
        trackName: "Song",
      }),
    ),
  );

  const layer = McpService.layer.pipe(
    Layer.provide([Stats.layer, Scrobbles.layer]),
    Layer.provide(Users.layer),
    Layer.provide(makeWorkerInfraLayer(env)),
  );

  const args = { username: "calendar", range: "today", timeZone: "Europe/Athens" };

  const call = (name: string, extra: { limit?: number; cursor?: string; since?: number } = {}) =>
    Effect.runPromise(
      Effect.flatMap(McpService, (mcp) =>
        mcp.callTool(userId, { name, arguments: { ...args, ...extra } }),
      ).pipe(Effect.provide(layer)),
    );

  const readText = Schema.decodeUnknownSync(Schema.Struct({ text: Schema.String }));

  const decodePage = Schema.decodeUnknownSync(
    Schema.fromJsonString(
      Schema.Struct({
        items: Schema.Array(Schema.Struct({ scrobbleDate: Schema.String })),
        nextCursor: Schema.NullOr(Schema.String),
      }),
    ),
  );

  const readPage = async (cursor?: string) => {
    const page = await call("get_recent_scrobbles", { limit: 1, ...(cursor && { cursor }) });

    return decodePage(readText(page.content[0]).text);
  };

  vi.useFakeTimers({ toFake: ["Date"] });

  try {
    vi.setSystemTime(new Date("2026-10-25T21:59:59Z"));
    const summary = await call("get_summary");
    expect(JSON.parse(readText(summary.content[0]).text).totalScrobbles).toBe(2);

    const first = await readPage();
    const cursor = Schema.decodeUnknownSync(Schema.String)(first.nextCursor);

    vi.setSystemTime(new Date("2026-10-25T22:00:01Z"));
    expect(await readPage(cursor)).toMatchObject({
      items: [{ scrobbleDate: "2026-10-24T21:00:00.000Z" }],
      nextCursor: null,
    });
    expect((await call("get_summary", { since: 0 })).isError).toBe(true);
  } finally {
    vi.useRealTimers();
  }
});
