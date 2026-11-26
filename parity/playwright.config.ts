import { defineConfig } from "@playwright/test";
import { fileURLToPath } from "node:url";

const target = process.env.PARITY_TARGET ?? "current";

if (target !== "current" && target !== "next") {
  throw new Error("PARITY_TARGET must be current or next");
}

if (
  target === "next" &&
  process.argv.some(
    (argument) => argument.startsWith("-u") || /^--update-snapshots(=|$)/.test(argument),
  )
) {
  throw new Error("Only the current app can update parity baselines");
}

const maxDiffPixelRatio = Number(process.env.PARITY_MAX_DIFF_RATIO ?? "0");

if (!(maxDiffPixelRatio >= 0 && maxDiffPixelRatio <= 1)) {
  throw new Error("PARITY_MAX_DIFF_RATIO must be between 0 and 1");
}

const externalURL =
  target === "current" ? process.env.PARITY_BASE_URL : process.env.PARITY_NEXT_URL;

const baseURL =
  externalURL ?? (target === "current" ? "http://localhost:5173" : "http://localhost:5174");

const defaultCommand =
  target === "current" ? "bun run --cwd app dev" : "bun run --cwd effect-app dev";

const command = process.env.PARITY_COMMAND ?? (externalURL ? undefined : defaultCommand);

export default defineConfig({
  testDir: "./test",
  snapshotPathTemplate: "{testDir}/../baselines/{projectName}/{arg}{ext}",
  updateSnapshots: "none",
  forbidOnly: !!process.env.CI,
  workers: 2,
  expect: {
    toHaveScreenshot: { animations: "disabled", caret: "hide", maxDiffPixelRatio },
  },
  use: {
    baseURL,
    browserName: "chromium",
    locale: "en-US",
    timezoneId: "UTC",
    colorScheme: "light",
    contextOptions: { reducedMotion: "reduce" },
    serviceWorkers: "block",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "desktop", use: { viewport: { width: 1280, height: 900 } } },
    {
      name: "mobile",
      use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
    },
  ],
  webServer: command
    ? { command, cwd: fileURLToPath(new URL("..", import.meta.url)), url: baseURL }
    : undefined,
});
