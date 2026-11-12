/**
 * Readable text for the OAuth error codes that Better Auth sends in `?error=`.
 *
 * Unknown codes get a generic message, and the page shows the code itself, so a
 * new Better Auth version cannot produce a blank error page.
 */
export function describeAuthError(code: string | null) {
  switch (code) {
    case "access_denied":
      return "You cancelled the sign-in on Spotify.";
    case "unable_to_get_user_info":
      return "Spotify did not send back your profile. Spotify is most likely rate limiting us, so try again in a few minutes.";
    case "invalid_code":
      return "Spotify rejected the sign-in attempt. Try again.";
    case "email_not_found":
      return "Spotify did not share an email address for your account.";
    case "state_mismatch":
      return "The sign-in session expired. Try again.";
    default:
      return "We could not sign you in with Spotify.";
  }
}
