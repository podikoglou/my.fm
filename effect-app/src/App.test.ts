import { deepEqual } from "node:assert/strict";
import { test } from "node:test";

import { Query } from "@effect/ui";
import { Effect, Layer } from "effect";
import { AsyncResult } from "effect/reactivity";

import { refreshViewerAfterOnboarding } from "./App";
import { GetViewer, ViewerSchema } from "./features/profile/queries";

void test("refreshes a cached incomplete viewer before returning from onboarding", () => {
  const viewer = {
    id: "user-river",
    name: "River Stone",
    username: "river",
    email: "river@example.com",
    avatarUrl: null,
    onboarded: false,
    isPrivate: false,
  };

  let onboarded = false;

  const ViewerLayer = GetViewer.toLayer(() =>
    Effect.sync(() => ViewerSchema.SignedIn({ user: { ...viewer, onboarded } })),
  );

  return Effect.runPromise(
    Effect.gen(function* () {
      yield* GetViewer.get({});
      onboarded = true;

      yield* refreshViewerAfterOnboarding;

      const result = yield* GetViewer.peek({});
      deepEqual(
        AsyncResult.isSuccess(result) && result.value,
        ViewerSchema.SignedIn({ user: { ...viewer, onboarded: true } }),
      );
    }).pipe(Effect.provide(Layer.merge(Query.layer(), ViewerLayer))),
  );
});
