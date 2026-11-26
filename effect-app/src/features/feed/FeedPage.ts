import type { FeedItemSchema } from "@my.fm/api";
import { PublicFeedPageSchema } from "@my.fm/api";
import { Component, Head, Mount, Query, UiSchema } from "@effect/ui";
import { Html } from "@effect/ui/html";
import { formatDistanceToNow } from "date-fns";
import { Effect, Option, Queue, Schema, Stream } from "effect";
import { AsyncResult } from "effect/reactivity";

import { EmptyState } from "../../components/EmptyState";
import { icon } from "../../components/icon";
import { publicApiClient } from "../../lib/api";
import { spotifyUriToUrl } from "../../lib/spotify";
import { AppRoute } from "../../routes";

export class ListFeed extends Query.InfiniteService<ListFeed>()("feed/ListFeed", {
  args: {},
  page: PublicFeedPageSchema,
  items: (page) => page.items,
  key: (item) => item.id,
  cursor: Schema.String,
  next: (page) => Option.fromNullishOr(page.nextCursor),
  error: Schema.String,
  staleTime: "0 seconds",
}) {
  static readonly layer = this.toLayer((_args, cursor) =>
    publicApiClient.feed
      .getFeed({
        query: Option.isSome(cursor) ? { cursor: cursor.value } : {},
      })
      .pipe(Effect.mapError(() => "Couldn't load the feed")),
  );
}

export const ObserveEnd = Mount.makeStream("ObserveEnd", { args: {} }, (node: HTMLElement) =>
  Stream.callback<boolean>((queue) =>
    Effect.acquireRelease(
      Effect.sync(() => {
        const observer = new IntersectionObserver(
          (entries) => {
            if (entries.some((entry) => entry.isIntersecting)) Queue.offerUnsafe(queue, true);
          },
          { threshold: 0.1 },
        );

        observer.observe(node);

        return observer;
      }),
      (observer) => Effect.sync(() => observer.disconnect()),
    ),
  ),
);

function SpotifyLink<M>(h: Html.H<M>, label: string, uri?: string) {
  const url = spotifyUriToUrl(uri);

  return url
    ? h.a
        .attrs({
          href: url,
          target: "_blank",
          rel: "noopener noreferrer",
          class: "hover:underline",
        })
        .children(label)
    : label;
}

function FeedTrack<M>(h: Html.H<M>, item: typeof FeedItemSchema.Type) {
  const albumUrl = spotifyUriToUrl(item.album.spotifyUri);

  const cover = h.div
    .class("relative size-9 shrink-0 overflow-hidden rounded-md bg-muted")
    .children(
      h.div
        .class("absolute inset-0 flex items-center justify-center")
        .children(icon(h, "music", "size-4 text-muted-foreground")),
      h.img.attrs({ src: item.track.imageUrl, alt: "", class: "relative size-full object-cover" }),
    );

  return h.div
    .key(item.id)
    .class("flex items-center gap-3 rounded-lg p-2 hover:bg-muted/50")
    .children(
      albumUrl
        ? h.a
            .attrs({
              href: albumUrl,
              target: "_blank",
              rel: "noopener noreferrer",
              class: "shrink-0 rounded-md transition-opacity hover:opacity-80",
              "aria-label": `Open ${item.album.name} on Spotify`,
            })
            .children(cover)
        : cover,
      h.div.class("min-w-0 flex-1").children(
        h.p.class("truncate text-xs text-muted-foreground").children(
          h.a
            .attrs({
              href: AppRoute.print(AppRoute.User({ params: { username: item.user.username } })),
              class: "font-medium text-foreground hover:underline",
            })
            .children(item.user.name),
          " listened to ",
          item.track.artists.map((artist, index) =>
            h.span
              .key(String(index))
              .children(index > 0 ? ", " : "", SpotifyLink(h, artist.name, artist.spotifyUri)),
          ),
        ),
        h.p
          .class("truncate text-xs font-medium")
          .children(SpotifyLink(h, item.track.name, item.track.spotifyUri)),
      ),
      h.span
        .class("shrink-0 text-xs text-muted-foreground")
        .children(formatDistanceToNow(item.scrobbleDate, { addSuffix: true })),
    );
}

export const FeedPageMessage = UiSchema.TaggedEnum({ ReachedEnd: {} });

export const FeedPageNoDeps = Html.component({
  name: "FeedPage",
  model: Schema.Struct({}),
  message: FeedPageMessage,
  queries: { feed: { query: ListFeed, args: () => ({}) } },
}).make({
  init: () => ({}),
  update: {
    ReachedEnd: ($) => $.loadMore("feed"),
  },
  head: () => [Head.title("Feed")],
  view: (h) =>
    h.div.class("contents").children(
      h.header
        .class("grid auto-rows-min grid-rows-[auto_auto] items-start gap-1.5 px-6")
        .children(
          h.h1.class("text-3xl leading-none font-bold").children("Feed"),
          h.p
            .class("mt-2 text-sm text-muted-foreground")
            .children("The latest scrobbles from everyone."),
        ),
      h.div.class("min-h-0 flex-1 overflow-hidden px-6").children(
        AsyncResult.match(h.queries.feed, {
          onInitial: () => h.div,
          onFailure: () => EmptyState(h, "Couldn't Load the Feed", "We're not sure why"),
          onSuccess: ({ value: { items, more, pages } }) =>
            items.length === 0
              ? h.div
                  .class("flex h-full flex-col items-center justify-center gap-2 text-center")
                  .children(
                    icon(h, "listMusic", "size-10 text-muted-foreground opacity-50"),
                    h.p.class("text-sm text-muted-foreground").children("No scrobbles yet."),
                  )
              : more._tag === "Failed"
                ? EmptyState(h, "Couldn't Load the Feed", "We're not sure why")
                : h.div.class("timeline-scroll h-full space-y-1 overflow-y-auto pr-1").children(
                    items.map((item) => FeedTrack(h, item)),
                    more._tag === "Available" &&
                      h.div
                        .key(`end-${pages.length}`)
                        .class("h-1")
                        .onMount(ObserveEnd().pipe(Mount.map(() => FeedPageMessage.ReachedEnd()))),
                  ),
        }),
      ),
    ),
});

export const FeedPage = FeedPageNoDeps.pipe(Component.provide(ListFeed.layer));
