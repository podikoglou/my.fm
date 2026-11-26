import { Component, Mount } from "@effect/ui";
import { Effect } from "effect";

export const HideFailedImage = Mount.make(
  "HideFailedImage",
  { args: {} },
  (image: HTMLImageElement) =>
    Effect.acquireRelease(
      Effect.sync(() => {
        const failed = () => {
          image.style.display = "none";
        };

        const loaded = () => {
          image.style.removeProperty("display");
        };

        image.addEventListener("error", failed);
        image.addEventListener("load", loaded);

        if (image.complete && image.naturalWidth === 0) failed();

        return { failed, loaded };
      }),
      ({ failed, loaded }) =>
        Effect.sync(() => {
          image.removeEventListener("error", failed);
          image.removeEventListener("load", loaded);
        }),
    ).pipe(Effect.as(Component.noop)),
);
