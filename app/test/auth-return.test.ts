import { expect, test } from "vitest";

import { authReturnPath, onboardingPath } from "../app/lib/auth-return.ts";

test("preserves the original OAuth query through onboarding", () => {
  const consent =
    "/oauth/authorize?client_id=example&state=a%2Bb%26c&redirect_uri=https%3A%2F%2Fclient.example%2Fcallback";

  const onboard = onboardingPath(consent);

  expect(authReturnPath("https://app.test" + onboard)).toBe(consent);
});

test("onboarding defaults home and rejects external return destinations", () => {
  for (const destination of [
    "",
    "https://evil.example",
    "//evil.example",
    String.raw`/\evil.example`,
  ]) {
    const url = new URL("/onboard", "https://app.test");

    url.searchParams.set("returnTo", destination);

    expect(authReturnPath(url.href)).toBe("/");
  }
});
