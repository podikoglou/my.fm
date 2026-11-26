import type { Html } from "@effect/ui/html";

const LABEL_HEIGHT = 24;

export function ScrollMonthLabel<M>(
  h: Html.H<M>,
  options: {
    readonly label: string;
    readonly progress: number;
    readonly viewportHeight: number;
    readonly visible: boolean;
  },
) {
  return h.span
    .attrs({
      "data-slot": "badge",
      "aria-hidden": "true",
      class:
        "pointer-events-none absolute right-3 z-20 inline-flex h-6 w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-full border bg-card px-2.5 py-0.5 text-xs font-medium whitespace-nowrap text-foreground shadow-xs transition-opacity duration-150 motion-reduce:transition-none",
    })
    .style({
      top: `${options.progress * Math.max(0, options.viewportHeight - LABEL_HEIGHT)}px`,
      opacity: options.visible ? "1" : "0",
    })
    .children(options.label);
}
