import { Music } from "lucide-react";
import { Link } from "react-router";

import { spotifyUriToUrl } from "~/lib/spotify";

import { Avatar, AvatarFallback, AvatarImage } from "./ui/avatar";

export function FeedTrack({
  user,
  track,
  album,
  time,
}: {
  user: { username: string; name: string };
  track: {
    name: string;
    imageUrl: string;
    spotifyUri?: string;
    artists: { name: string; spotifyUri?: string }[];
  };
  album?: {
    name?: string;
    spotifyUri?: string;
  };
  time: string | null;
}) {
  const albumUrl = spotifyUriToUrl(album?.spotifyUri);
  const trackUrl = spotifyUriToUrl(track.spotifyUri);

  const cover = (
    <Avatar className="h-9 w-9 rounded-md">
      <AvatarImage src={track.imageUrl} />
      <AvatarFallback>
        <Music className="h-4 w-4 text-muted-foreground" />
      </AvatarFallback>
    </Avatar>
  );

  return (
    <div className="flex items-center gap-3 rounded-lg p-2 hover:bg-muted/50">
      {albumUrl ? (
        <a
          href={albumUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="shrink-0 rounded-md transition-opacity hover:opacity-80"
          aria-label={album?.name ? `Open ${album.name} on Spotify` : "Open album on Spotify"}
        >
          {cover}
        </a>
      ) : (
        cover
      )}

      <div className="min-w-0 flex-1">
        <p className="truncate text-xs text-muted-foreground">
          <Link
            to={`/user/${user.username}`}
            className="font-medium text-foreground hover:underline"
          >
            {user.name}
          </Link>{" "}
          listened to{" "}
          {track.artists.map((artist, index) => {
            const artistUrl = spotifyUriToUrl(artist.spotifyUri);

            return (
              <span key={artist.spotifyUri ?? `${artist.name}-${index}`}>
                {index > 0 && ", "}
                {artistUrl ? (
                  <a
                    href={artistUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="hover:text-foreground hover:underline"
                  >
                    {artist.name}
                  </a>
                ) : (
                  artist.name
                )}
              </span>
            );
          })}
        </p>
        <p className="truncate text-xs font-medium">
          {trackUrl ? (
            <a
              href={trackUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="hover:underline"
            >
              {track.name}
            </a>
          ) : (
            track.name
          )}
        </p>
      </div>

      {time ? <span className="shrink-0 text-xs text-muted-foreground">{time}</span> : null}
    </div>
  );
}
