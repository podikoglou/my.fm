import { createScrobbleId, type PlayRecord } from "../db/queries/scrobbles.ts";
import type { SpotifyPlay } from "../spotify/service.ts";

/** Fallback Spotify quota block when no numeric Retry-After is available (30 min). */
export const SPOTIFY_QUOTA_FALLBACK_SECONDS = 30 * 60;

/** Maximum Spotify quota block duration (24 hours). */
export const SPOTIFY_QUOTA_MAX_SECONDS = 24 * 60 * 60;

/** Active listeners are polled every 3 minutes. */
export const ACTIVE_FETCH_INTERVAL_MS = 3 * 60_000;

/** Inactive users are polled every 10 minutes. */
export const INACTIVE_FETCH_INTERVAL_MS = 10 * 60_000;

/** A user stays active for 15 minutes after their latest recent play. */
export const ACTIVE_WINDOW_MS = 15 * 60_000;

export interface UserScheduleState {
  readonly lastFetchedAt: Date | null;
  readonly lastActiveAt: Date | null;
  readonly lastRecentTracksFetchTime?: Date | null;
}

export function isUserActive(lastActiveAt: Date | null, now: Date): boolean {
  if (!lastActiveAt) {
    return false;
  }

  return now.getTime() - lastActiveAt.getTime() < ACTIVE_WINDOW_MS;
}

/**
 * Decide whether an account's history interval has elapsed.
 *
 * Returns `true` immediately when the user has never been fetched or when
 * their cursor was reset to `null`.
 */
export function shouldFetchUser(user: UserScheduleState, now: Date): boolean {
  if (!user.lastFetchedAt || user.lastRecentTracksFetchTime === null) {
    return true;
  }

  const intervalMs = isUserActive(user.lastActiveAt, now)
    ? ACTIVE_FETCH_INTERVAL_MS
    : INACTIVE_FETCH_INTERVAL_MS;

  return now.getTime() - user.lastFetchedAt.getTime() >= intervalMs;
}

export function computeQuotaBlock(retryAfterSeconds: number | null, now: Date): Date {
  const seconds = Math.min(
    Math.max(retryAfterSeconds ?? SPOTIFY_QUOTA_FALLBACK_SECONDS, 1),
    SPOTIFY_QUOTA_MAX_SECONDS,
  );

  return new Date(now.getTime() + seconds * 1000);
}

export async function toPlayRecord(userId: string, play: SpotifyPlay): Promise<PlayRecord> {
  const scrobbleDate = new Date(play.played_at);
  const id = await createScrobbleId(userId, scrobbleDate);
  const albumImageUrl = play.track.album.images[0]?.url;

  return {
    id,
    userId,
    scrobbleDate,
    artistName: play.track.artists.map((artist) => artist.name).join(", "),
    albumName: play.track.album.name,
    trackName: play.track.name,
    coverArtUrl: albumImageUrl ?? null,
    track: {
      name: play.track.name,
      spotifyUri: play.track.uri,
      releaseDate: play.track.album.release_date,
      imageUrl: albumImageUrl ?? "",
      trackNumber: play.track.track_number,
      explicit: play.track.explicit,
      duration: play.track.duration_ms,
      artists: play.track.artists.map((artist) => ({
        name: artist.name,
        spotifyUri: artist.uri,
      })),
    },
    album: {
      name: play.track.album.name,
      spotifyUri: play.track.album.uri,
      releaseDate: play.track.album.release_date,
      totalTracks: play.track.album.total_tracks,
      albumType: play.track.album.album_type,
      imageUrl: albumImageUrl ?? "",
      artists: play.track.album.artists.map((artist) => ({
        name: artist.name,
        spotifyUri: artist.uri,
      })),
    },
  };
}
