import type { ReactNode } from "react";

import { Music } from "lucide-react";

import { spotifyUriToUrl } from "~/lib/spotify";

import { Avatar, AvatarFallback, AvatarImage } from "./ui/avatar";

export function Track({
  artist,
  artists,
  title,
  extra,
  imageUrl,
  albumSpotifyUri,
  albumTitle,
  trackSpotifyUri,
}: {
  artist?: string;
  artists?: { name: string; spotifyUri?: string }[];
  title: string;
  extra?: ReactNode;
  imageUrl?: string;
  albumSpotifyUri?: string;
  albumTitle?: string;
  trackSpotifyUri?: string;
}) {
  const albumUrl = spotifyUriToUrl(albumSpotifyUri);
  const trackUrl = spotifyUriToUrl(trackSpotifyUri);

  const cover = (
    <Avatar className="h-9 w-9 rounded-md">
      <AvatarImage src={imageUrl} />
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
          aria-label={albumTitle ? `Open ${albumTitle} on Spotify` : "Open album on Spotify"}
        >
          {cover}
        </a>
      ) : (
        cover
      )}

      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">
          {trackUrl ? (
            <a
              href={trackUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="hover:underline"
            >
              {title}
            </a>
          ) : (
            title
          )}
        </p>
        <p className="truncate text-xs text-muted-foreground">
          {artists
            ? artists.map((a, index) => {
                const artistUrl = spotifyUriToUrl(a.spotifyUri);

                return (
                  <span key={a.spotifyUri ?? `${a.name}-${index}`}>
                    {index > 0 && ", "}
                    {artistUrl ? (
                      <a
                        href={artistUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="hover:text-foreground hover:underline"
                      >
                        {a.name}
                      </a>
                    ) : (
                      a.name
                    )}
                  </span>
                );
              })
            : artist}
        </p>
      </div>

      <div>{extra}</div>
    </div>
  );
}
