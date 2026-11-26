import type { Html } from "@effect/ui/html";

const paths = {
  music: [
    "M9 18V5l12-2v13",
    "M9 18a3 3 0 1 1-3-3c1.66 0 3 1.34 3 3",
    "M21 16a3 3 0 1 1-3-3c1.66 0 3 1.34 3 3",
  ],
  listMusic: ["M16 5H3", "M11 12H3", "M11 19H3", "M21 16V5"],
  bell: ["M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9", "M10 21h4"],
  key: [
    "M15.5 7.5a5.5 5.5 0 1 1-3.54 9.71L8 21H5v-3H2v-3l5.79-5.79A5.5 5.5 0 0 1 15.5 7.5",
    "M16 11h.01",
  ],
};

export function icon<M>(h: Html.H<M>, name: keyof typeof paths, className = "size-4") {
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
      paths[name].map((d) => h.el("path").attr("d", d)),
      name === "listMusic" && h.el("circle").attrs({ cx: "18", cy: "16", r: "3" }),
    );
}
