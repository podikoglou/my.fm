/**
 * Turn a Spotify URI (e.g. `spotify:track:123`) or existing URL into an
 * `open.spotify.com` web URL.
 */
export function spotifyUriToUrl(uri?: string | null): string | undefined {
  if (!uri) return undefined;

  if (uri.startsWith("https://") || uri.startsWith("http://")) {
    return uri;
  }

  const parts = uri.split(":");

  if (parts.length >= 3 && parts[0] === "spotify") {
    const [, type, id] = parts;

    return `https://open.spotify.com/${type}/${id}`;
  }

  return uri;
}
