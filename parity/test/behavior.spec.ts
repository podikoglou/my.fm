import type { Page } from "@playwright/test";

import { account, consent, notification, spotifyLogin } from "./data";
import { expect, test } from "./fixtures";

const consentQuery = "?client_id=wave-reader&state=parity";

test("failed feed artwork shows only the music fallback", async ({ page }) => {
  await page.route("https://fixtures.example.test/cover.svg", (route) => route.abort());
  await page.goto("/feed");
  const cover = page.getByRole("link", { name: "Open Coastlines on Spotify" }).first();
  await expect(cover.locator("img")).toBeHidden();
  await expect(cover.locator('[data-slot="avatar-fallback"]')).toBeVisible();
  await expect(cover.locator("svg")).toBeVisible();
});

function requestTo(page: Page, method: string, path: string) {
  return page.waitForRequest(
    (request) => request.method() === method && new URL(request.url()).pathname === path,
  );
}

test("home redirects to the public feed and exposes profile and Spotify links", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/feed$/);
  await expect(page.getByRole("link", { name: "Morning Tide" })).toHaveAttribute(
    "href",
    "https://open.spotify.com/track/track0",
  );
  await expect(
    page.getByRole("link", { name: "Open Coastlines on Spotify" }).first(),
  ).toHaveAttribute("href", "https://open.spotify.com/album/coastlines");
  await page.getByRole("link", { name: "River Stone" }).first().click();
  await expect(page).toHaveURL(/\/user\/river$/);
  await expect(page.getByRole("heading", { name: "River Stone" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Settings" })).toHaveCount(0);
});

test.describe("pagination", () => {
  test.use({ scenario: { feed: "paged", history: "paged" } });

  test("scrolling the feed requests its next cursor and displays more plays", async ({ page }) => {
    await page.goto("/feed");
    const first = page.getByRole("link", { name: "Morning Tide" });
    await first.hover();
    const next = requestTo(page, "GET", "/api/feed");
    await page.mouse.wheel(0, 5000);
    expect(new URL((await next).url()).searchParams.get("cursor")).toBe("next-feed");
    const more = page.getByRole("link", { name: "After the Break" });
    await expect(more).toBeVisible();
    await page.mouse.wheel(0, 5000);
    await expect(more).toBeInViewport();
  });

  test("scrolling profile history renders plays from beyond the initial page", async ({ page }) => {
    await page.goto("/user/river");
    await page.getByRole("link", { name: "Morning Tide" }).hover();
    await page.mouse.wheel(0, 5000);
    await expect(
      page.getByRole("link", { name: "History track 31", exact: true }),
    ).toBeInViewport();
  });
});

test("signed-out settings starts Spotify sign-in and preserves the return path", async ({
  page,
}) => {
  const pending = requestTo(page, "POST", "/api/auth/sign-in/social");
  await page.goto("/settings");
  expect((await pending).postDataJSON()).toMatchObject({
    provider: "spotify",
    callbackURL: "/settings",
    errorCallbackURL: "/auth/error",
  });
  await expect(page).toHaveURL(spotifyLogin);
});

test("auth error shows the failure and retries Spotify sign-in", async ({ page }) => {
  await page.goto("/auth/error?error=access_denied&error_description=Login%20was%20cancelled");
  await expect(page.getByText("Login was cancelled")).toBeVisible();
  const pending = requestTo(page, "POST", "/api/auth/sign-in/social");
  await page.getByRole("button", { name: "Try again" }).click();
  expect((await pending).postDataJSON()).toMatchObject({ provider: "spotify", callbackURL: "/" });
  await expect(page).toHaveURL(spotifyLogin);
});

test.describe("onboarding", () => {
  test.use({ scenario: { session: "onboarding" } });

  test("settings gates incomplete accounts; onboarding validates and honors returnTo", async ({
    page,
  }) => {
    await page.goto("/settings");
    await expect(page).toHaveURL(/\/onboard$/);
    await page.goto("/onboard?returnTo=%2Fsettings");
    await page.getByRole("textbox", { name: /^(Name|kyle)$/ }).fill("River Stone");
    const username = page.getByRole("textbox", { name: /^(Username|kyles)$/ });
    await username.fill("x");
    const submit = page.getByRole("button", { name: "Submit" });
    await submit.click();
    await expect(page.getByText("Username must be at least 3 characters")).toBeVisible();
    await username.fill("river");
    const pending = requestTo(page, "PUT", "/api/user/onboard");
    await submit.click();
    expect((await pending).postDataJSON()).toEqual({ name: "River Stone", username: "river" });
    await expect(page).toHaveURL(/\/settings$/);
    await expect(page.getByRole("switch", { name: "Private profile" })).toBeVisible();
  });

  test("OAuth consent sends incomplete accounts to onboarding with its original URL", async ({
    page,
  }) => {
    await page.goto(`/oauth/authorize${consentQuery}`);
    await expect(page).toHaveURL(/\/onboard\?/);
    expect(new URL(page.url()).searchParams.get("returnTo")).toBe(
      `/oauth/authorize${consentQuery}`,
    );
  });
});

test.describe("signed-in account", () => {
  test.use({ scenario: { session: "in", notification: true } });

  test("profile owner can dismiss a notification and navigate to settings and back", async ({
    page,
  }) => {
    await page.goto("/user/river");
    const notice = page.getByRole("button", { name: /Listening history imported/ });
    const acknowledged = requestTo(page, "POST", "/api/notifications/notice-1/acknowledge");
    await notice.click();
    await acknowledged;
    await expect(notice).toHaveCount(0);
    await page.getByRole("link", { name: "Settings" }).click();
    await expect(page).toHaveURL(/\/settings$/);
    await page.getByRole("link", { name: "Back" }).click();
    await expect(page).toHaveURL(/\/user\/river$/);
  });

  test("profile navigation does not save notifications in browser history", async ({ page }) => {
    await page.goto("/user/river");
    await expect(page.getByRole("button", { name: notification.title })).toBeVisible();
    await page.getByRole("link", { name: "Settings" }).click();
    await expect(page).toHaveURL(/\/settings$/);
    await page.goBack();
    await expect(page).toHaveURL(/\/user\/river$/);

    expect(await page.evaluate(() => JSON.stringify(history.state))).not.toContain(notification.id);
  });

  test("settings hides email by default and persists a privacy change across reload", async ({
    page,
  }) => {
    await page.goto("/settings");
    const reveal = page.getByRole("button", { name: "Reveal email" });
    await expect(page.getByText(account.email)).toHaveCount(0);
    await reveal.click();
    const email = page.getByRole("button", { name: account.email });
    await expect(email).toBeVisible();
    await email.click();
    await expect(reveal).toBeVisible();
    const privacy = page.getByRole("switch", { name: "Private profile" });
    await expect(privacy).not.toBeChecked();
    const pending = requestTo(page, "PATCH", "/api/user/settings");
    await privacy.click();
    expect((await pending).postDataJSON()).toEqual({ isPrivate: true });
    await page.reload();
    await expect(privacy).toBeChecked();
  });

  test("settings uploads the chosen CSV and reports that it was accepted", async ({ page }) => {
    await page.goto("/settings");
    const chooser = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: "Import", exact: true }).click();
    const pending = requestTo(page, "POST", "/api/import");
    await (
      await chooser
    ).setFiles({
      name: "history.csv",
      mimeType: "text/csv",
      buffer: Buffer.from("track,artist\nMorning Tide,North Pier"),
    });
    expect((await pending).headers()["content-type"]).toContain("multipart/form-data");
    await expect(
      page.getByText("File accepted. Ingestion will process in the background."),
    ).toBeVisible();
    await expect(page.getByText("Status: pending")).toBeVisible();
  });

  test("settings opens agent instructions and revokes a connected app", async ({ page }) => {
    await page.goto("/settings");
    await page.getByRole("button", { name: "Connect an agent" }).click();
    const dialog = page.getByRole("dialog", { name: "Connect an agent" });
    await expect(dialog.getByText(/Paste this into your agent/)).toBeVisible();
    const copy = dialog.getByRole("button", { name: "Copy" });
    await expect(copy).toBeEnabled();
    await copy.focus();
    await page.keyboard.press("Shift+Tab");
    const prompt = dialog.locator("pre");
    await expect(prompt).toBeFocused();
    await page.keyboard.press("PageDown");
    await expect.poll(() => prompt.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
    await dialog.getByRole("button", { name: "Done" }).click();
    await expect(dialog).toHaveCount(0);
    const app = page.getByRole("link", { name: "Wave Reader" });
    await expect(app).toHaveAttribute("href", "https://reader.example.test");
    const revoked = requestTo(page, "DELETE", "/api/oauth/apps/app-1");
    await page.getByRole("button", { name: "Revoke" }).click();
    await revoked;
    await expect(app).toHaveCount(0);
  });

  test("signing out returns to the feed and protects settings again", async ({ page }) => {
    await page.goto("/settings");
    const pending = requestTo(page, "POST", "/api/auth/sign-out");
    await page.getByRole("button", { name: "Sign out" }).click();
    await pending;
    await expect(page).toHaveURL(/\/feed$/);
    await page.goto("/settings");
    await expect(page).toHaveURL(spotifyLogin);
  });

  for (const decision of ["allow", "deny"] as const) {
    test(`OAuth consent submits ${decision} and follows the callback`, async ({ page }) => {
      await page.goto(`/oauth/authorize${consentQuery}`);
      await expect(page.getByText(/Wave Reader wants read-only access/)).toBeVisible();
      const pending = requestTo(page, "POST", "/api/oauth/authorize");
      await page.getByRole("button", { name: new RegExp(`^${decision}$`, "i") }).click();
      expect((await pending).postDataJSON()).toEqual({ decision, query: consentQuery });
      await expect(page).toHaveURL(consent.redirectUri);
    });
  }
});
