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
      d: "M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z",
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
