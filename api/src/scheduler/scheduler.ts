import { getLogger } from "@logtape/logtape";
import { SpotifyApi } from "@spotify/web-api-ts-sdk";

import { auth } from "../auth";
import { addAlbumArtist } from "../db/queries/albumArtists";
import { createAlbum } from "../db/queries/albums";
import { createArtist } from "../db/queries/artists";
import { createScrobble } from "../db/queries/scrobbles";
import { addTrackArtist } from "../db/queries/trackArtists";
import { createTrack } from "../db/queries/tracks";
import { findUserQueueDataById, updateLastRecentTracksFetchTime } from "../db/queries/users";
import { env } from "../env";
import { fetchQueue } from "./queue";

const logger = getLogger(["my.fm", "scheduler"]);

const INTERVAL = 5 * 1000;

const FETCH_LIMIT_INITIAL = 50;
const FETCH_LIMIT_REGULAR = 6;

export function setupScheduler() {
  logger.debug`Setting scheduler up`;

  setInterval(async () => {
    // get item from queue
    const userId = fetchQueue.next();

    if (!userId) {
      logger.warn`No items in the queue`;
      return;
    }

    // get user's spotify access token
    const result = await auth.api.getAccessToken({
      body: { providerId: "spotify", userId },
    });

    if (!result?.accessToken) {
      logger.error`No Spotify access token for user ${userId}`;
      return;
    }

    // create spotify client
    const apiClient = SpotifyApi.withAccessToken(env.SPOTIFY_CLIENT_ID, {
      access_token: result.accessToken,
      token_type: "Bearer",
      expires_in: 3600,
      refresh_token: "",
    });

    // get queue item data
    const queueItemData = await findUserQueueDataById(userId);

    if (!queueItemData) {
      logger.warn`User in queue disappeared`;
      return;
    }

    const { lastRecentTracksFetchTime } = queueItemData;

    // fetch recent tracks
    const limit = lastRecentTracksFetchTime ? FETCH_LIMIT_REGULAR : FETCH_LIMIT_INITIAL;

    let plays;

    if (lastRecentTracksFetchTime) {
      plays = await apiClient.player.getRecentlyPlayedTracks(limit, {
        type: "after",
        timestamp: lastRecentTracksFetchTime.getTime(),
      });

      logger.debug`fetched ${plays.total} recently played tracks (after ${lastRecentTracksFetchTime})`;
    } else {
      plays = await apiClient.player.getRecentlyPlayedTracks(limit);

      logger.debug`fetched ${plays.total} recently played tracks (initial)`;
    }

    let mostRecentScrobbleDate: Date | null = null;

    // go through recent plays
    for (const play of plays.items) {
      logger.debug`fetched play ${play}`;

      const scrobbleDate = new Date(play.played_at);
      if (!mostRecentScrobbleDate || scrobbleDate > mostRecentScrobbleDate) {
        mostRecentScrobbleDate = scrobbleDate;
      }

      const album = play.track.album;

      // insert track's and album's artist in database (skipped if already there)
      // (should generally be the same, but we can never know for sure)
      for (const { name, uri } of play.track.artists) {
        await createArtist({ spotifyUri: uri, name });
      }

      for (const { name, uri } of album.artists) {
        await createArtist({ spotifyUri: uri, name });
      }

      // insert album in database (skipped if already there)
      await createAlbum({
        spotifyUri: album.uri,
        name: album.name,
        releaseDate: album.release_date,
        totalTracks: album.total_tracks,
        albumType: album.album_type,
        imageUrl: album.images[0]?.url ?? "",
      });

      // insert album's artist (skipped if already there)
      for (let i = 0; i < album.artists.length; i++) {
        const artist = album.artists[i];
        if (!artist) continue;

        await addAlbumArtist(album.uri, artist.uri, i);
      }

      // insert track in database (skipped if already there)
      await createTrack({
        spotifyUri: play.track.uri,
        name: play.track.name,
        trackNumber: play.track.track_number,
        releaseDate: album.release_date,
        imageUrl: album.images[0]?.url ?? "",
        explicit: play.track.explicit,
        duration: play.track.duration_ms,
      });

      // insert track's artist (skipped if already there)
      for (let i = 0; i < play.track.artists.length; i++) {
        const artist = play.track.artists[i];
        if (!artist) continue;

        await addTrackArtist(play.track.uri, artist.uri, i);
      }

      // finally, insert scrobble in database
      await createScrobble({
        userId,
        trackSpotifyUri: play.track.uri,
        albumSpotifyUri: album.uri,
        scrobbleDate: scrobbleDate,
      });
    }

    // update last recent tracks fetched time
    if (mostRecentScrobbleDate) {
      await updateLastRecentTracksFetchTime(userId, mostRecentScrobbleDate);
    } else if (lastRecentTracksFetchTime) {
      await updateLastRecentTracksFetchTime(userId, new Date());
    }
  }, INTERVAL);
}
