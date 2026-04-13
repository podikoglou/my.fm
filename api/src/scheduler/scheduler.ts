// this is a very important constnat, and there's different ways to tweak this,

import { getLogger } from "@logtape/logtape";
import { withAccessToken } from "../spotify";
import { fetchQueue } from "./queue";

const logger = getLogger(["my.fm", "scheduler"]);

// but it's okay for now (especially for one user)
const INTERVAL = 5 * 1000;

export function setupScheduler() {
  logger.debug`Setting scheduler up`;

  setInterval(async () => {
    const item = fetchQueue.pop();

    if (!item) {
      return;
    }

    // TODO: this should be a part of the item. the initial (seed) fetch
    // should fetch as many as possible and the subsequent ones should
    // fetch an amount that's a function of the last time we fetched
    const limit = 1;

    const apiClient = withAccessToken(item.accessToken);
    const { items: plays } = await apiClient.player.getRecentlyPlayedTracks(limit);

    for (const play of plays) {
      logger.debug`fetched play ${play}`;
    }
  }, INTERVAL);
}
