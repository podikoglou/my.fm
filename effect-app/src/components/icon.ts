import type { Html } from "@effect/ui/html";

const paths = {
  music: ["M9 18V5l12-2v13"],
  listMusic: ["M16 5H3", "M11 12H3", "M11 19H3", "M21 16V5"],
  bell: [
    "M10.268 21a2 2 0 0 0 3.464 0",
    "M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326",
  ],
  key: [
    "M2.586 17.414A2 2 0 0 0 2 18.828V21a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h1a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h.172a2 2 0 0 0 1.414-.586l.814-.814a6.5 6.5 0 1 0-4-4z",
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
      name === "music" && h.el("circle").attrs({ cx: "6", cy: "18", r: "3" }),
      name === "music" && h.el("circle").attrs({ cx: "18", cy: "16", r: "3" }),
      name === "key" &&
        h.el("circle").attrs({ cx: "16.5", cy: "7.5", r: ".5", fill: "currentColor" }),
    );
}
