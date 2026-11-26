export function spotifyUriToUrl(uri?: string | null): string | undefined {
  if (!uri) return undefined;

  if (uri.startsWith("http://") || uri.startsWith("https://")) return uri;
  const parts = uri.split(":");

  if (parts.length >= 3 && parts[0] === "spotify") {
    return `https://open.spotify.com/${parts[1]}/${parts[2]}`;
  }

  return uri;
}
