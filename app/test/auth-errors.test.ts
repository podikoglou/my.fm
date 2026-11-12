import { expect, test } from "bun:test";

import { describeAuthError } from "../app/lib/auth-errors.ts";

test("explains the codes that this OAuth flow can produce", () => {
  const codes = [
    "access_denied",
    "unable_to_get_user_info",
    "invalid_code",
    "email_not_found",
    "state_mismatch",
  ];

  for (const code of codes) {
    expect(describeAuthError(code)).not.toBe(describeAuthError("another_code"));
  }
});

test("falls back to a generic message for an unknown or missing code", () => {
  expect(describeAuthError("another_code")).toBe(describeAuthError(null));
  expect(describeAuthError(null)).toContain("We could not sign you in with Spotify.");
});
