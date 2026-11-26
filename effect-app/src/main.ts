import { Router } from "@effect/ui";
import { BrowserHost, BrowserRouter } from "@effect/ui/html";
import { Effect, Layer } from "effect";

import { App } from "./App";
import { AppRoute } from "./routes";
import "./styles.css";

const container = document.getElementById("app");

if (!container) throw new Error("Missing app mount element");

const main = BrowserHost.mount(App, Router.props(AppRoute), container).pipe(
  Layer.provide(BrowserRouter.layer({ routes: AppRoute })),
);

Layer.launch(main).pipe(Effect.runFork);
