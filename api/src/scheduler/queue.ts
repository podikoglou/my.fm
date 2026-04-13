import type { AccessToken } from "@spotify/web-api-ts-sdk";
import type { User } from "../db/schema";
import { findUsersWithSpotify } from "../db/queries/users";
import { logger } from "../logger";

export type QueueItem = {
  userId: User["id"];
  accessToken: AccessToken;
};

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

  for (const user of users) {
    if (!user.spotifyAccessToken || !user.spotifyRefreshToken || !user.spotifyTokenExpiration) {
      continue;
    }

    fetchQueue.push({
      userId: user.id,
      accessToken: {
        access_token: user.spotifyAccessToken,
        token_type: "Bearer",
        expires_in: Number(user.spotifyTokenExpiration),
        refresh_token: user.spotifyRefreshToken,
      },
    });
  }
}
