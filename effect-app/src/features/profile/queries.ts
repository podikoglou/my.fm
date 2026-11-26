import {
  ProfilePrivateApiError,
  ProjectedScrobbleSchema,
  PublicUserSchema,
  SessionUserSchema,
} from "@my.fm/api";
import { Query, UiSchema } from "@effect/ui";
import { Effect, Schema } from "effect";

import { apiClient } from "../../lib/api";
import { authClient } from "../../lib/auth";
import { MonthSchema, PAGE_SIZE, toMonths } from "./history-timeline";

export const ProfileLookupError = Schema.Literals(["private", "not_found"]);

export type ProfileLookupError = typeof ProfileLookupError.Type;

const isProfilePrivateError = Schema.is(ProfilePrivateApiError);

export const ViewerSchema = UiSchema.TaggedEnum({
  Anonymous: {},
  SignedIn: { user: SessionUserSchema },
});

export type Viewer = typeof ViewerSchema.Type;

export class GetUserByUsername extends Query.Service<GetUserByUsername>()(
  "profile/GetUserByUsername",
  {
    args: { username: Schema.String },
    success: PublicUserSchema,
    error: ProfileLookupError,
    staleTime: "0 seconds",
  },
) {
  static readonly layer = this.toLayer(({ username }) =>
    apiClient.user
      .byUsername({ query: { username } })
      .pipe(
        Effect.mapError(
          (error): ProfileLookupError => (isProfilePrivateError(error) ? "private" : "not_found"),
        ),
      ),
  );
}

export class GetViewer extends Query.Service<GetViewer>()("profile/GetViewer", {
  args: {},
  success: ViewerSchema,
  error: Schema.String,
  staleTime: "0 seconds",
}) {
  static readonly layer = this.toLayer(() =>
    Effect.gen(function* () {
      const session = yield* Effect.tryPromise({
        try: () => authClient.getSession(),
        catch: () => "Session unavailable",
      });

      if (!session.data) return ViewerSchema.Anonymous();

      const user = yield* apiClient.user
        .me()
        .pipe(Effect.mapError(() => "Current user unavailable"));

      return ViewerSchema.SignedIn({ user });
    }),
  );
}

export class GetScrobbleMonths extends Query.Service<GetScrobbleMonths>()(
  "profile/GetScrobbleMonths",
  {
    args: { username: Schema.String },
    success: Schema.Array(MonthSchema),
    error: Schema.String,
    staleTime: "0 seconds",
  },
) {
  static readonly layer = this.toLayer(({ username }) =>
    apiClient.scrobble
      .getMonths({
        query: {
          username,
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        },
      })
      .pipe(
        Effect.map((counts) => toMonths(counts)),
        Effect.mapError(() => "Couldn't load scrobble months"),
      ),
  );
}

export class GetHistoryPage extends Query.Service<GetHistoryPage>()("profile/GetHistoryPage", {
  args: {
    username: Schema.String,
    monthKey: Schema.String,
    monthCount: Schema.Finite,
    before: Schema.Finite,
    page: Schema.Finite,
  },
  success: Schema.Array(ProjectedScrobbleSchema),
  error: Schema.String,
  staleTime: "60 seconds",
}) {
  static readonly layer = this.toLayer(({ username, before, page }) =>
    apiClient.scrobble
      .getRecent({
        query: {
          username,
          before,
          offset: page * PAGE_SIZE,
          limit: PAGE_SIZE,
        },
      })
      .pipe(Effect.mapError(() => "Couldn't load history page")),
  );
}
