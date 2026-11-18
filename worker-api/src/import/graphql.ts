export type GqlArtist = {
  name?: string | null;
  spotifyUrl?: string | null;
  imageUrl?: string | null;
};

export type GqlAlbum = {
  title?: string | null;
  releaseDate?: string | null;
  type?: string | null;
  spotifyUrl?: string | null;
  coverArt?: {
    front500?: string | null;
    front?: string | null;
  } | null;
};

export type GqlTrack = {
  title?: string | null;
  spotifyUrl?: string | null;
  coverArt?: {
    front500?: string | null;
    front?: string | null;
  } | null;
  artist?: GqlArtist | null;
  album?: GqlAlbum | null;
};

export type ResolvedTrackMetadata = {
  trackSpotifyUri: string | null;
  albumSpotifyUri: string | null;
  artistSpotifyUri: string | null;
  artistName: string;
  albumName: string | null;
  trackName: string;
  coverArtUrl: string | null;
  artistImageUrl: string | null;
  albumReleaseDate: string;
  albumType: string;
};

export const GRAPHQL_ENDPOINT = "https://music.aleep.lol/graphql";

export const GRAPHQL_BATCH_SIZE = 100;

export const GRAPHQL_THROTTLE_MS = 350;

export function spotifyUrlToUri(url?: string | null): string | null {
  if (!url) {
    return null;
  }

  const trimmed = url.trim();

  if (trimmed.length === 0) {
    return null;
  }

  if (trimmed.startsWith("spotify:")) {
    return trimmed;
  }

  const match = trimmed.match(/open\.spotify\.com\/(track|album|artist)\/([a-zA-Z0-9_-]+)/);

  if (match && match[1] && match[2]) {
    return `spotify:${match[1]}:${match[2]}`;
  }

  return null;
}

export type QueryItem = {
  key: string;
  artist: string;
  title: string;
  album?: string | null;
};

export function buildBatchQuery(items: QueryItem[]): string {
  const fields = items.map((item, index) => {
    const alias = `q${index}`;
    const artistArg = JSON.stringify(item.artist);
    const titleArg = JSON.stringify(item.title);
    const albumArg = item.album ? `, album: ${JSON.stringify(item.album)}` : "";

    return `
      ${alias}: track(artist: ${artistArg}, title: ${titleArg}${albumArg}) {
        title
        spotifyUrl
        coverArt { front500 front }
        artist { name spotifyUrl imageUrl }
        album { title releaseDate type spotifyUrl coverArt { front500 front } }
      }
    `;
  });

  return `query ResolveBatch {\n${fields.join("\n")}\n}`;
}

export function extractResolvedMetadata(
  rawArtist: string,
  rawTitle: string,
  rawAlbum: string | null,
  track: GqlTrack | null,
): ResolvedTrackMetadata {
  if (!track) {
    return {
      trackSpotifyUri: null,
      albumSpotifyUri: null,
      artistSpotifyUri: null,
      artistName: rawArtist,
      albumName: rawAlbum,
      trackName: rawTitle,
      coverArtUrl: null,
      artistImageUrl: null,
      albumReleaseDate: "",
      albumType: "album",
    };
  }

  const trackSpotifyUri = spotifyUrlToUri(track.spotifyUrl);
  const albumSpotifyUri = spotifyUrlToUri(track.album?.spotifyUrl);
  const artistSpotifyUri = spotifyUrlToUri(track.artist?.spotifyUrl);

  const coverArtUrl =
    track.coverArt?.front500 ||
    track.album?.coverArt?.front500 ||
    track.coverArt?.front ||
    track.album?.coverArt?.front ||
    null;

  return {
    trackSpotifyUri,
    albumSpotifyUri,
    artistSpotifyUri,
    artistName: track.artist?.name || rawArtist,
    albumName: track.album?.title || rawAlbum,
    trackName: track.title || rawTitle,
    coverArtUrl,
    artistImageUrl: track.artist?.imageUrl || null,
    albumReleaseDate: track.album?.releaseDate || "",
    albumType: track.album?.type || "album",
  };
}

export type GqlResponseBody = {
  data?: Record<string, GqlTrack | null>;
  errors?: { message: string }[];
};

export async function fetchGraphQLBatch(
  endpoint: string,
  query: string,
): Promise<Record<string, GqlTrack | null>> {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ query }),
  });

  if (!response.ok) {
    throw new Error(`GraphQL request failed: ${response.status} ${response.statusText}`);
  }

  // SAFETY: GraphQL endpoint returns a standard JSON envelope with data and optional errors.
  const json = (await response.json()) as GqlResponseBody;

  return json.data ?? {};
}

export async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
