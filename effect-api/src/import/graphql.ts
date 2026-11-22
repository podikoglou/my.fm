import { Effect, Schema } from "effect";

import { GraphQLBatchError } from "./errors.ts";

const GqlCoverArtSchema = Schema.Struct({
  front500: Schema.optional(Schema.NullOr(Schema.String)),
  front: Schema.optional(Schema.NullOr(Schema.String)),
});

const GqlArtistSchema = Schema.Struct({
  name: Schema.optional(Schema.NullOr(Schema.String)),
  spotifyUrl: Schema.optional(Schema.NullOr(Schema.String)),
  imageUrl: Schema.optional(Schema.NullOr(Schema.String)),
});

const GqlAlbumSchema = Schema.Struct({
  title: Schema.optional(Schema.NullOr(Schema.String)),
  releaseDate: Schema.optional(Schema.NullOr(Schema.String)),
  type: Schema.optional(Schema.NullOr(Schema.String)),
  spotifyUrl: Schema.optional(Schema.NullOr(Schema.String)),
  coverArt: Schema.optional(Schema.NullOr(GqlCoverArtSchema)),
});

const GqlTrackSchema = Schema.Struct({
  title: Schema.optional(Schema.NullOr(Schema.String)),
  spotifyUrl: Schema.optional(Schema.NullOr(Schema.String)),
  coverArt: Schema.optional(Schema.NullOr(GqlCoverArtSchema)),
  artist: Schema.optional(Schema.NullOr(GqlArtistSchema)),
  album: Schema.optional(Schema.NullOr(GqlAlbumSchema)),
});

const GraphQLEnvelopeSchema = Schema.Struct({
  data: Schema.optional(Schema.Record(Schema.String, Schema.NullOr(GqlTrackSchema))),
  errors: Schema.optional(
    Schema.Array(
      Schema.Struct({
        message: Schema.String,
      }),
    ),
  ),
});

export type GqlArtist = Schema.Schema.Type<typeof GqlArtistSchema>;

export type GqlAlbum = Schema.Schema.Type<typeof GqlAlbumSchema>;

export type GqlTrack = Schema.Schema.Type<typeof GqlTrackSchema>;

export type ResolvedTrackMetadata = {
  readonly trackSpotifyUri: string | null;
  readonly albumSpotifyUri: string | null;
  readonly artistSpotifyUri: string | null;
  readonly artistName: string;
  readonly albumName: string | null;
  readonly trackName: string;
  readonly coverArtUrl: string | null;
  readonly artistImageUrl: string | null;
  readonly albumReleaseDate: string;
  readonly albumType: string;
};

export const GRAPHQL_ENDPOINT = "https://music.aleep.lol/graphql";

export const GRAPHQL_BATCH_SIZE = 100;

export const GRAPHQL_THROTTLE_MS = 350;

const TRACK_FIELDS = `
  title
  spotifyUrl
  coverArt { front500 front }
  artist { name spotifyUrl imageUrl }
  album { title releaseDate type spotifyUrl coverArt { front500 front } }
`;

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

  if (!match) {
    return null;
  }

  return `spotify:${match[1]}:${match[2]}`;
}

export type QueryItem = {
  readonly key: string;
  readonly artist: string;
  readonly title: string;
  readonly album?: string | null;
};

export function buildBatchQuery(items: ReadonlyArray<QueryItem>): string {
  const parts = items.map((item, idx) => {
    const artistArg = JSON.stringify(item.artist);
    const titleArg = JSON.stringify(item.title);

    const args = item.album
      ? `artist: ${artistArg}, title: ${titleArg}, album: ${JSON.stringify(item.album)}`
      : `artist: ${artistArg}, title: ${titleArg}`;

    return `  q${idx}: track(${args}) { ${TRACK_FIELDS} }`;
  });

  return `{\n${parts.join("\n")}\n}`;
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

  const coverArtUrl =
    track.coverArt?.front500 ??
    track.coverArt?.front ??
    track.album?.coverArt?.front500 ??
    track.album?.coverArt?.front ??
    null;

  return {
    trackSpotifyUri: spotifyUrlToUri(track.spotifyUrl),
    albumSpotifyUri: spotifyUrlToUri(track.album?.spotifyUrl),
    artistSpotifyUri: spotifyUrlToUri(track.artist?.spotifyUrl),
    artistName: track.artist?.name ?? rawArtist,
    albumName: track.album?.title ?? rawAlbum,
    trackName: track.title ?? rawTitle,
    coverArtUrl,
    artistImageUrl: track.artist?.imageUrl ?? null,
    albumReleaseDate: track.album?.releaseDate ?? "",
    albumType: track.album?.type ?? "album",
  };
}

const decodeGraphQLEnvelope = Schema.decodeUnknownSync(GraphQLEnvelopeSchema);

export async function fetchGraphQLBatch(
  endpoint: string,
  query: string,
): Promise<Record<string, GqlTrack | null>> {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });

  if (!response.ok) {
    throw new Error(`GraphQL request failed: ${response.status} ${response.statusText}`);
  }

  const rawJson = await response.json();
  const parsed = decodeGraphQLEnvelope(rawJson);

  if (parsed.errors && parsed.errors.length > 0) {
    throw new Error(`GraphQL errors: ${parsed.errors.map((err) => err.message).join("; ")}`);
  }

  if (!parsed.data) {
    throw new Error("GraphQL response missing data");
  }

  return parsed.data;
}

export type FetchGraphQLBatch = (
  endpoint: string,
  query: string,
) => Promise<Record<string, GqlTrack | null>>;

export type ResolveOptions = {
  readonly endpoint?: string;
  readonly batchSize?: number;
  readonly throttleMs?: number;
  readonly fetchBatch?: FetchGraphQLBatch;
};

function toErrorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

const runBatchPass = Effect.fn("import.runBatchPass")(function* (
  items: ReadonlyArray<QueryItem>,
  options: {
    readonly endpoint: string;
    readonly batchSize: number;
    readonly throttleMs: number;
    readonly fetchBatch: FetchGraphQLBatch;
  },
  isFirstBatch: boolean,
): Effect.fn.Return<Map<string, GqlTrack | null>, GraphQLBatchError> {
  const results = new Map<string, GqlTrack | null>();

  for (let i = 0; i < items.length; i += options.batchSize) {
    if ((!isFirstBatch || i > 0) && options.throttleMs > 0) {
      yield* Effect.sleep(`${options.throttleMs} millis`);
    }

    const batch = items.slice(i, i + options.batchSize);
    const query = buildBatchQuery(batch);

    const data = yield* Effect.tryPromise({
      try: () => options.fetchBatch(options.endpoint, query),
      catch: (cause) => new GraphQLBatchError({ message: toErrorMessage(cause) }),
    });

    for (let j = 0; j < batch.length; j++) {
      const item = batch[j];

      if (!item) {
        continue;
      }

      const alias = `q${j}`;

      if (!Object.hasOwn(data, alias)) {
        return yield* new GraphQLBatchError({
          message: `GraphQL batch response missing expected alias ${alias}`,
        });
      }

      results.set(item.key, data[alias] ?? null);
    }
  }

  return results;
});

/**
 * Resolve a deduplicated set of tracks using the 2-pass album waterfall:
 *   Pass 1: query with album when available
 *   Pass 2: for items queried with album that returned null, retry without album
 */
export const resolveTracksWaterfallEffect = Effect.fn("import.resolveTracksWaterfall")(function* (
  items: ReadonlyArray<QueryItem>,
  options?: ResolveOptions,
): Effect.fn.Return<Map<string, ResolvedTrackMetadata>, GraphQLBatchError> {
  const endpoint = options?.endpoint ?? GRAPHQL_ENDPOINT;
  const batchSize = options?.batchSize ?? GRAPHQL_BATCH_SIZE;
  const throttleMs = options?.throttleMs ?? GRAPHQL_THROTTLE_MS;
  const fetchBatch = options?.fetchBatch ?? fetchGraphQLBatch;

  const uniqueMap = new Map<string, QueryItem>();

  for (const item of items) {
    if (!uniqueMap.has(item.key)) {
      uniqueMap.set(item.key, item);
    }
  }

  const uniqueItems = [...uniqueMap.values()];

  if (uniqueItems.length === 0) {
    return new Map();
  }

  const pass1Results = yield* runBatchPass(
    uniqueItems,
    { endpoint, batchSize, throttleMs, fetchBatch },
    true,
  );

  const retryItems: QueryItem[] = [];

  for (const item of uniqueItems) {
    const result = pass1Results.get(item.key);

    if (!result && item.album) {
      retryItems.push({
        key: item.key,
        artist: item.artist,
        title: item.title,
        album: null,
      });
    }
  }

  const pass2Results =
    retryItems.length > 0
      ? yield* runBatchPass(retryItems, { endpoint, batchSize, throttleMs, fetchBatch }, false)
      : new Map<string, GqlTrack | null>();

  const resolved = new Map<string, ResolvedTrackMetadata>();

  for (const item of uniqueItems) {
    const pass1Track = pass1Results.get(item.key);
    const gqlTrack = pass1Track ?? pass2Results.get(item.key) ?? null;
    const fallbackAlbum = pass1Track ? (item.album ?? null) : null;

    resolved.set(
      item.key,
      extractResolvedMetadata(item.artist, item.title, fallbackAlbum, gqlTrack),
    );
  }

  return resolved;
});

export async function resolveTracksWaterfall(
  items: ReadonlyArray<QueryItem>,
  options?: ResolveOptions,
): Promise<Map<string, ResolvedTrackMetadata>> {
  return Effect.runPromise(
    resolveTracksWaterfallEffect(items, options).pipe(
      Effect.catchTag("GraphQLBatchError", (err) => Effect.die(new Error(err.message))),
    ),
  );
}
