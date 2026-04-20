import z from "zod";

import type { User } from "../db/schema";

import { findUsersWithSpotify } from "../db/queries/users";
import { logger } from "../logger";
export type QueueItem = User["id"];

export const queueItemDataSchema = z.object({
  lastRecentTracksFetchTime: z.date().nullable(),
});

export type QueueItemData = z.infer<typeof queueItemDataSchema>;

export class FetchQueue {
  private inner: QueueItem[] = [];

  push(item: QueueItem) {
    this.inner.push(item);
  }

  next(): QueueItem | undefined {
    const item = this.inner.shift();

    if (item) {
      this.push(item);
    }

    return item;
  }

  size(): number {
    return this.inner.length;
  }
}

export const fetchQueue = new FetchQueue();

export async function seedFetchQueue() {
  const accounts = await findUsersWithSpotify();

  logger.info(`Seeding fetch queue with ${accounts.length} items`);

  accounts.forEach((account) => fetchQueue.push(account.userId));
}
