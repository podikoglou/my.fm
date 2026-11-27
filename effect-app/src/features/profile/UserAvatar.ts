import type { Html } from "@effect/ui/html";

import { HideFailedImage } from "../../components/HideFailedImage";

function initials(name: string): string {
  const split = name.split(" ");

  if (split.length > 1) {
    return split
      .map((part) => part[0] ?? "")
      .join("")
      .toUpperCase();
  }

  return ((name[0] ?? "") + (name[1] ?? "")).toUpperCase();
}

export function UserAvatar<M>(
  h: Html.H<M>,
  options: {
    readonly avatarUrl: string | null;
    readonly name: string;
  },
) {
  return h.span
    .attr("data-slot", "avatar")
    .class("relative flex h-24 w-24 shrink-0 overflow-hidden rounded-full")
    .children(
      h.span
        .attr("data-slot", "avatar-fallback")
        .class(
          "flex size-full items-center justify-center rounded-full bg-muted text-3xl select-none",
        )
        .children(initials(options.name)),
      options.avatarUrl !== null &&
        h.img
          .attrs({
            "data-slot": "avatar-image",
            src: options.avatarUrl,
            alt: "User",
            class: "absolute inset-0 size-full object-cover",
          })
          .onMount(HideFailedImage()),
    );
}
