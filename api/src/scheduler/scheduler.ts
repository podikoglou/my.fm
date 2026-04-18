import { getLogger } from "@logtape/logtape";
import { ensureFreshAccessToken, userDataToAccessToken, withAccessToken } from "../spotify";
import { fetchQueue, queueItemDataSchema } from "./queue";
import { createAlbum } from "../db/queries/albums";
import { createTrack } from "../db/queries/tracks";
import { createScrobble } from "../db/queries/scrobbles";
import {
  findUserQueueDataById,
  updateLastRecentTracksFetchTime,
  updateUserAccessToken,
} from "../db/queries/users";

const logger = getLogger(["my.fm", "scheduler"]);

// this is a very important constnat, and there's different ways to tweak this,
// but it's okay for now (especially for one user)
const INTERVAL = 5 * 1000;

const FETCH_LIMIT_INITIAL = 50;
const FETCH_LIMIT_REGULAR = 6;

export function setupScheduler() {
  logger.debug`Setting scheduler up`;

  setInterval(async () => {
    const userId = fetchQueue.pop();

    if (!userId) {
      logger.warn`No items in the queue`;
      return;
    }

    // fetch relevant up-to-date data about the user
    const rawItemData = await findUserQueueDataById(userId);

    if (!rawItemData) {
      logger.warn`User in queue disappeared`;
      return;
    }

    // parse data
    const { data: itemData, success: parseSuccess } = queueItemDataSchema.safeParse(rawItemData);

    if (!parseSuccess) {
      logger.error`Couldn't parse queue item data (invalid data in db?)`;
      return;
    }

    // refresh token if needed, then create API client
    const accessToken = await ensureFreshAccessToken(itemData.accessToken, async (newToken) => {
      await updateUserAccessToken(userId, userDataToAccessToken.encode(newToken));
    });
    const apiClient = withAccessToken(accessToken);

    // fetch plays
    const limit = itemData.lastRecentTracksFetchTime ? FETCH_LIMIT_REGULAR : FETCH_LIMIT_INITIAL;

    let plays;

    if (itemData.lastRecentTracksFetchTime) {
      // if we've fetched before, don't re-fetch the same tracks
      plays = await apiClient.player.getRecentlyPlayedTracks(limit, {
        type: "after",
        timestamp: itemData.lastRecentTracksFetchTime.getTime(),
      });

      logger.debug`fetched ${plays.total} recently played tracks (after ${itemData.lastRecentTracksFetchTime})`;
    } else {
      // if we haven't feched before, don't have an "after"
      plays = await apiClient.player.getRecentlyPlayedTracks(limit);

      logger.debug`fetched ${plays.total} recently played tracks (initial)`;
    }

    let mostRecentScrobbleDate: Date | null = null;

    for (const play of plays.items) {
      logger.debug`fetched play ${play}`;

      const scrobbleDate = new Date(play.played_at);
      if (!mostRecentScrobbleDate || scrobbleDate > mostRecentScrobbleDate) {
        mostRecentScrobbleDate = scrobbleDate;
      }

      const album = play.track.album;

      await createAlbum({
        spotifyUri: album.uri,
        name: album.name,
        releaseDate: album.release_date,
        totalTracks: album.total_tracks,
        albumType: album.album_type,
        imageUrl: album.images[0]?.url ?? "",
      });

      await createTrack({
        spotifyUri: play.track.uri,
        name: play.track.name,
        trackNumber: play.track.track_number,
        releaseDate: album.release_date,
        totalTracks: album.total_tracks,
        albumType: album.album_type,
        imageUrl: album.images[0]?.url ?? "",
        explicit: play.track.explicit,
        duration: play.track.duration_ms,
      });

      await createScrobble({
        userId,
        trackSpotifyUri: play.track.uri,
        albumSpotifyUri: album.uri,
        scrobbleDate: scrobbleDate,
      });
    }

    if (mostRecentScrobbleDate) {
      await updateLastRecentTracksFetchTime(userId, mostRecentScrobbleDate);
    } else if (itemData.lastRecentTracksFetchTime) {
      await updateLastRecentTracksFetchTime(userId, new Date());
    }
  }, INTERVAL);
}
