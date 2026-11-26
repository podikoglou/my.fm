import type { Page } from "@playwright/test";

import { expect, test } from "./fixtures";

function screenshot(page: Page, name: string) {
  return expect(page).toHaveScreenshot(`${name}.png`, { fullPage: true });
}

test("@visual home redirects to a populated public feed", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/feed$/);
  await expect(page.getByRole("link", { name: "Morning Tide" })).toBeVisible();
  await screenshot(page, "feed");
});

test.describe("empty feed and history", () => {
  test.use({ scenario: { feed: "empty", history: "empty" } });

  test("@visual empty feed", async ({ page }) => {
    await page.goto("/feed");
    await expect(page.getByText("No scrobbles yet.")).toBeVisible();
    await screenshot(page, "feed-empty");
  });

  test("@visual empty profile history", async ({ page }) => {
    await page.goto("/user/river");
    await expect(page.getByText("No scrobbles yet.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
    await screenshot(page, "profile-empty");
  });
});

test.describe("failed feed and history", () => {
  test.use({ scenario: { feed: "error", history: "error" } });

  test("@visual feed unavailable", async ({ page }) => {
    await page.goto("/feed");
    await expect(page.getByText("Couldn't Load the Feed")).toBeVisible();
    await screenshot(page, "feed-error");
  });

  test("@visual profile history unavailable", async ({ page }) => {
    await page.goto("/user/river");
    await expect(page.getByText("Couldn't Find Scrobbles")).toBeVisible();
    await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
    await screenshot(page, "profile-history-error");
  });
});

test("@visual public profile", async ({ page }) => {
  await page.goto("/user/river");
  await expect(page.getByRole("link", { name: "Morning Tide" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
  await screenshot(page, "profile-public");
});

for (const state of [
  { name: "private", user: "private", message: "Private Profile" },
  { name: "missing", user: "not-found", message: "User Not Found" },
]) {
  test(`@visual ${state.name} profile`, async ({ page }) => {
    await page.goto(`/user/${state.user}`);
    await expect(page.getByText(state.message, { exact: true })).toBeVisible();
    await screenshot(page, `profile-${state.name}`);
  });
}

test.describe("signed-in surfaces", () => {
  test.use({ scenario: { session: "in" } });

  test("@visual account settings", async ({ page }) => {
    await page.goto("/settings");
    await expect(page.getByRole("link", { name: "Wave Reader" })).toBeAttached();
    await screenshot(page, "settings");
  });

  test("@visual dark settings can be selected and survive reload", async ({ page }) => {
    await page.goto("/settings");
    const theme = page.getByRole("combobox", { name: "Theme" });
    await theme.click();
    await page.getByRole("option", { name: "Dark" }).click();
    await page.reload();
    await expect(theme).toHaveText("Dark");
    await expect(page.getByRole("link", { name: "Wave Reader" })).toBeAttached();
    await screenshot(page, "settings-dark");
  });

  test("@visual OAuth consent", async ({ page }) => {
    await page.goto("/oauth/authorize?client_id=wave-reader&state=parity");
    await expect(page.getByRole("button", { name: "Allow" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Deny" })).toBeVisible();
    await screenshot(page, "oauth-consent");
  });
});

test.describe("owner profile", () => {
  test.use({ scenario: { session: "in", notification: true } });

  test("@visual owner profile with notification", async ({ page }) => {
    await page.goto("/user/river");
    await expect(page.getByRole("link", { name: "Morning Tide" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Settings" })).toBeVisible();
    await expect(page.getByRole("list", { name: "Notifications" })).toBeVisible();
    await screenshot(page, "profile-owner");
  });
});

test.describe("invalid consent", () => {
  test.use({ scenario: { session: "in", consent: "invalid" } });

  test("@visual expired OAuth request", async ({ page }) => {
    await page.goto("/oauth/authorize?client_id=expired");
    await expect(
      page.getByText(/This authorization request is invalid or has expired/),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Allow" })).toHaveCount(0);
    await screenshot(page, "oauth-invalid");
  });
});

test.describe("incomplete account", () => {
  test.use({ scenario: { session: "onboarding" } });

  test("@visual onboarding form and validation", async ({ page }) => {
    await page.goto("/onboard");
    await expect(page.getByRole("textbox", { name: /^(Username|kyles)$/ })).toBeVisible();
    await screenshot(page, "onboarding");
    await page.getByRole("button", { name: "Submit" }).click();
    await expect(page.getByText("Username must be at least 3 characters")).toBeVisible();
    await screenshot(page, "onboarding-invalid");
  });
});

test("@visual sign-in failure", async ({ page }) => {
  await page.goto("/auth/error?error=access_denied&error_description=Login%20was%20cancelled");
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
  await screenshot(page, "auth-error");
});

test("@visual unknown page", async ({ page }) => {
  await page.goto("/no-such-page");
  await expect(page.getByText("Page Not Found", { exact: true })).toBeVisible();
  await screenshot(page, "not-found");
});
