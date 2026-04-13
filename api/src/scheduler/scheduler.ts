// this is a very important constnat, and there's different ways to tweak this,

import { getLogger } from "@logtape/logtape";
import { withAccessToken } from "../spotify";
import { fetchQueue } from "./queue";
import { createAlbum } from "../db/queries/albums";
import { createTrack } from "../db/queries/tracks";
import { createScrobble } from "../db/queries/scrobbles";

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

      // create album in db (skipped if exists)
      // TODO: update if anything changed
      const album = play.track.album;

      await createAlbum({
        spotifyUri: album.uri,
        name: album.name,
        releaseDate: album.release_date,
        totalTracks: album.total_tracks,
        albumType: album.album_type,
        imageUrl: album.images[0]?.url ?? "",
      });

      // create track in db (skipped if exists)
      // TODO: update if anything changed
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

      // create scrobble in db

      const scrobbleDate = new Date(play.played_at);

      await createScrobble({
        userId: item.userId,
        trackSpotifyUri: play.track.uri,
        albumSpotifyUri: album.uri,
        scrobbleDate: scrobbleDate,
      });
    }
  }, INTERVAL);
}
