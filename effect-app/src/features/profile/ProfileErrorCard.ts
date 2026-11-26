import type { Html } from "@effect/ui/html";

import { icon } from "../../components/icon";
import { profileIcon, type ProfileIconName } from "./icons";

export function ProfileErrorCard<M>(
  h: Html.H<M>,
  iconName: ProfileIconName | "listMusic",
  title: string,
  description: string,
) {
  const graphic =
    iconName === "listMusic"
      ? icon(h, "listMusic", "h-16 w-16 text-muted-foreground opacity-50")
      : profileIcon(h, iconName, "h-16 w-16 text-muted-foreground opacity-50");

  return h.div
    .attr("data-slot", "card-header")
    .class(
      "@container/card-header flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center",
    )
    .children(
      graphic,
      h.div.children(
        h.div
          .attr("data-slot", "card-title")
          .class("text-3xl leading-none font-bold")
          .children(title),
        h.div
          .attr("data-slot", "card-description")
          .class("mt-2 text-sm text-muted-foreground")
          .children(description),
      ),
    );
}

export function ScrobblesError<M>(h: Html.H<M>) {
  return ProfileErrorCard(h, "listMusic", "Couldn't Find Scrobbles", "We're not sure why");
}
