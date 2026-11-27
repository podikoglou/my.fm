import type { View } from "@effect/ui";
import type { Html } from "@effect/ui/html";

import { HideFailedImage } from "../../components/HideFailedImage";
import { icon } from "../../components/icon";
import { spotifyUriToUrl } from "../../lib/spotify";

export interface TrackArtist {
  readonly name: string;
  readonly spotifyUri?: string | undefined;
}

export function Track<M, E extends View.Content<M> = never>(
  h: Html.H<M>,
  options: {
    readonly title: string;
    readonly artists?: readonly TrackArtist[] | undefined;
    readonly artist?: string | undefined;
    readonly imageUrl?: string | undefined;
    readonly albumSpotifyUri?: string | undefined;
    readonly albumTitle?: string | undefined;
    readonly trackSpotifyUri?: string | undefined;
    readonly extra?: E | undefined;
  },
) {
  const albumUrl = spotifyUriToUrl(options.albumSpotifyUri);
  const trackUrl = spotifyUriToUrl(options.trackSpotifyUri);

  const cover = h.span
    .attr("data-slot", "avatar")
    .class("relative flex h-9 w-9 shrink-0 overflow-hidden rounded-md")
    .children(
      h.span
        .attr("data-slot", "avatar-fallback")
        .class("flex size-full items-center justify-center rounded-full bg-muted select-none")
        .children(icon(h, "music", "h-4 w-4 text-muted-foreground")),
      options.imageUrl !== undefined &&
        options.imageUrl !== "" &&
        h.img
          .attrs({
            "data-slot": "avatar-image",
            src: options.imageUrl,
            alt: "",
            class: "absolute inset-0 size-full object-cover",
          })
          .onMount(HideFailedImage()),
    );

  return h.div.class("flex items-center gap-3 rounded-lg p-2 hover:bg-muted/50").children(
    albumUrl
      ? h.a
          .attrs({
            href: albumUrl,
            target: "_blank",
            rel: "noopener noreferrer",
            class: "shrink-0 rounded-md transition-opacity hover:opacity-80",
            "aria-label": options.albumTitle
              ? `Open ${options.albumTitle} on Spotify`
              : "Open album on Spotify",
          })
          .children(cover)
      : cover,
    h.div.class("min-w-0 flex-1").children(
      h.p.class("truncate text-sm font-medium").children(
        trackUrl
          ? h.a
              .attrs({
                href: trackUrl,
                target: "_blank",
                rel: "noopener noreferrer",
                class: "hover:underline",
              })
              .children(options.title)
          : options.title,
      ),
      h.p.class("truncate text-xs text-muted-foreground").children(
        options.artists
          ? options.artists.map((artist, index) => {
              const artistUrl = spotifyUriToUrl(artist.spotifyUri);

              return h.span.key(artist.spotifyUri ?? `${artist.name}-${index}`).children(
                index > 0 ? ", " : "",
                artistUrl
                  ? h.a
                      .attrs({
                        href: artistUrl,
                        target: "_blank",
                        rel: "noopener noreferrer",
                        class: "hover:text-foreground hover:underline",
                      })
                      .children(artist.name)
                  : artist.name,
              );
            })
          : (options.artist ?? ""),
      ),
    ),
    h.div.children(options.extra),
  );
}
