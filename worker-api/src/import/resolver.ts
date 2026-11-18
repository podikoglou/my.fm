import type { GqlTrack, QueryItem, ResolvedTrackMetadata } from "./graphql.ts";

import {
  buildBatchQuery,
  extractResolvedMetadata,
  fetchGraphQLBatch,
  GRAPHQL_BATCH_SIZE,
  GRAPHQL_ENDPOINT,
  GRAPHQL_THROTTLE_MS,
  sleep,
} from "./graphql.ts";

export type ResolveOptions = {
  endpoint?: string;
  batchSize?: number;
  throttleMs?: number;
  fetchBatch?: (endpoint: string, query: string) => Promise<Record<string, GqlTrack | null>>;
};

export async function resolveTracksWaterfall(
  items: QueryItem[],
  options?: ResolveOptions,
): Promise<Map<string, ResolvedTrackMetadata>> {
  const endpoint = options?.endpoint ?? GRAPHQL_ENDPOINT;
  const batchSize = options?.batchSize ?? GRAPHQL_BATCH_SIZE;
  const throttleMs = options?.throttleMs ?? GRAPHQL_THROTTLE_MS;
  const fetchBatch = options?.fetchBatch ?? fetchGraphQLBatch;

  const results = new Map<string, ResolvedTrackMetadata>();

  if (items.length === 0) {
    return results;
  }

  // Deduplicate query items by key to minimize outgoing queries.
  const uniqueItemsMap = new Map<string, QueryItem>();

  for (const item of items) {
    if (!uniqueItemsMap.has(item.key)) {
      uniqueItemsMap.set(item.key, item);
    }
  }

  const uniqueItems = Array.from(uniqueItemsMap.values());

  // Pass 1: Try with album if available, or without album if not.
  const pass1Unresolved: QueryItem[] = [];

  for (let i = 0; i < uniqueItems.length; i += batchSize) {
    if (i > 0 && throttleMs > 0) {
      await sleep(throttleMs);
    }

    const chunk = uniqueItems.slice(i, i + batchSize);
    const query = buildBatchQuery(chunk);

    try {
      const data = await fetchBatch(endpoint, query);

      for (let j = 0; j < chunk.length; j++) {
        const item = chunk[j];

        if (!item) {
          continue;
        }

        const alias = `q${j}`;
        const track = data[alias] ?? null;

        if (track) {
          results.set(
            item.key,
            extractResolvedMetadata(item.artist, item.title, item.album ?? null, track),
          );
        } else if (item.album) {
          // If track wasn't found with album, queue for Pass 2 without album.
          pass1Unresolved.push({
            key: item.key,
            artist: item.artist,
            title: item.title,
            album: null,
          });
        } else {
          // No album was provided and search failed.
          results.set(item.key, extractResolvedMetadata(item.artist, item.title, null, null));
        }
      }
    } catch {
      // On network or endpoint error, fill unresolved fallbacks.
      for (const item of chunk) {
        results.set(
          item.key,
          extractResolvedMetadata(item.artist, item.title, item.album ?? null, null),
        );
      }
    }
  }

  // Pass 2: Retry previously unresolved items without album.
  for (let i = 0; i < pass1Unresolved.length; i += batchSize) {
    if (throttleMs > 0) {
      await sleep(throttleMs);
    }

    const chunk = pass1Unresolved.slice(i, i + batchSize);
    const query = buildBatchQuery(chunk);

    try {
      const data = await fetchBatch(endpoint, query);

      for (let j = 0; j < chunk.length; j++) {
        const item = chunk[j];

        if (!item) {
          continue;
        }

        const alias = `q${j}`;
        const track = data[alias] ?? null;

        results.set(item.key, extractResolvedMetadata(item.artist, item.title, null, track));
      }
    } catch {
      for (const item of chunk) {
        results.set(item.key, extractResolvedMetadata(item.artist, item.title, null, null));
      }
    }
  }

  return results;
}
