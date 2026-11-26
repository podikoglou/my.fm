import type { Html } from "@effect/ui/html";

type SvgPart =
  | { readonly tag: "path"; readonly d: string }
  | { readonly tag: "rect"; readonly attrs: Readonly<Record<string, string>> }
  | { readonly tag: "circle"; readonly attrs: Readonly<Record<string, string>> }
  | { readonly tag: "line"; readonly attrs: Readonly<Record<string, string>> };

const icons = {
  lock: [
    {
      tag: "rect",
      attrs: { width: "18", height: "11", x: "3", y: "11", rx: "2", ry: "2" },
    },
    { tag: "path", d: "M7 11V7a5 5 0 0 1 10 0v4" },
  ],
  userX: [
    { tag: "path", d: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" },
    { tag: "circle", attrs: { cx: "9", cy: "7", r: "4" } },
    { tag: "line", attrs: { x1: "17", x2: "22", y1: "8", y2: "13" } },
    { tag: "line", attrs: { x1: "22", x2: "17", y1: "8", y2: "13" } },
  ],
  settings: [
    {
      tag: "path",
      d: "M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915",
    },
    { tag: "circle", attrs: { cx: "12", cy: "12", r: "3" } },
  ],
} satisfies Record<string, readonly SvgPart[]>;

export type ProfileIconName = keyof typeof icons;

export function profileIcon<M>(h: Html.H<M>, name: ProfileIconName, className = "size-4") {
  return h
    .el("svg")
    .attrs({
      viewBox: "0 0 24 24",
      fill: "none",
      stroke: "currentColor",
      "stroke-width": "2",
      "stroke-linecap": "round",
      "stroke-linejoin": "round",
      "aria-hidden": "true",
      class: className,
    })
    .children(
      icons[name].map((part) =>
        part.tag === "path" ? h.el("path").attr("d", part.d) : h.el(part.tag).attrs(part.attrs),
      ),
    );
}
