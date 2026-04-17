import type { User } from "../db/schema";
import { findUsersWithSpotify } from "../db/queries/users";
import { logger } from "../logger";
import z from "zod";
import { accessTokenSchema } from "../spotify";

export type QueueItem = User["id"];

export const queueItemDataSchema = accessTokenSchema
  .extend({
    lastRecentTracksFetchTime: z.date().nullable(),
  })
  .transform(({ lastRecentTracksFetchTime, ...accessToken }) => ({
    lastRecentTracksFetchTime,
    accessToken,
  }));

export type QueueItemData = z.infer<typeof queueItemDataSchema>;

export class FetchQueue {
  private inner: QueueItem[] = [];

  push(item: QueueItem) {
    this.inner.push(item);
  }

  pop(): QueueItem | undefined {
    const item = this.inner.pop();

    // we re-add it to the queue
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
  const users = await findUsersWithSpotify();

  logger.info(`Seeding fetch queue with ${users.length} items`);

  users.forEach((user) => fetchQueue.push(user.id));
}
