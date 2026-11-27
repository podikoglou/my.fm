import type { Html } from "@effect/ui/html";

import { icon } from "./icon";

export function EmptyState<M>(h: Html.H<M>, title: string, description: string) {
  return h.div
    .class("flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center")
    .children(
      icon(h, "listMusic", "size-16 text-muted-foreground opacity-50"),
      h.div.children(
        h.h2.class("text-3xl font-bold").children(title),
        h.p.class("mt-2 text-sm text-muted-foreground").children(description),
      ),
    );
}
