// this is a very important constnat, and there's different ways to tweak this,

import { getLogger } from "@logtape/logtape";
import { withAccessToken } from "../spotify";
import { fetchQueue } from "./queue";
import { createAlbum } from "../db/queries/albums";
import { createTrack } from "../db/queries/tracks";
import { createScrobble } from "../db/queries/scrobbles";
import { updateLastRecentTracksFetchTime } from "../db/queries/users";

const logger = getLogger(["my.fm", "scheduler"]);

// but it's okay for now (especially for one user)
const INTERVAL = 5 * 1000;

const FETCH_LIMIT_INITIAL = 50;
const FETCH_LIMIT_REGULAR = 6;

export function setupScheduler() {
  logger.debug`Setting scheduler up`;

  setInterval(async () => {
    const item = fetchQueue.pop();

    if (!item) {
      return;
    }

    const limit = item.lastRecentTracksFetchTime ? FETCH_LIMIT_REGULAR : FETCH_LIMIT_INITIAL;

    const apiClient = withAccessToken(item.accessToken);

    let plays;

    if (item.lastRecentTracksFetchTime) {
      // if we've fetched before, don't re-fetch the same tracks
      plays = await apiClient.player.getRecentlyPlayedTracks(limit, {
        type: "after",
        timestamp: item.lastRecentTracksFetchTime.getTime(),
      });
      logger.debug`fetched ${plays.total} recently played tracks (after ${item.lastRecentTracksFetchTime})`;
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
        userId: item.userId,
        trackSpotifyUri: play.track.uri,
        albumSpotifyUri: album.uri,
        scrobbleDate: scrobbleDate,
      });
    }

    if (mostRecentScrobbleDate) {
      await updateLastRecentTracksFetchTime(item.userId, mostRecentScrobbleDate);
    } else if (item.lastRecentTracksFetchTime) {
      await updateLastRecentTracksFetchTime(item.userId, new Date());
    }
  }, INTERVAL);
}
