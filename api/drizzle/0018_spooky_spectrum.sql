CREATE TABLE `album_artists` (
	`album_spotify_uri` text NOT NULL,
	`artist_spotify_uri` text NOT NULL,
	`position` integer NOT NULL,
	PRIMARY KEY(`album_spotify_uri`, `artist_spotify_uri`),
	FOREIGN KEY (`album_spotify_uri`) REFERENCES `albums`(`spotifyUri`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`artist_spotify_uri`) REFERENCES `artists`(`spotifyUri`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `artists` (
	`spotifyUri` text PRIMARY KEY NOT NULL,
	`createdAt` integer DEFAULT (unixepoch()),
	`name` text NOT NULL,
	`imageUrl` text
);
--> statement-breakpoint
CREATE TABLE `track_artists` (
	`track_spotify_uri` text NOT NULL,
	`artist_spotify_uri` text NOT NULL,
	`position` integer NOT NULL,
	PRIMARY KEY(`track_spotify_uri`, `artist_spotify_uri`),
	FOREIGN KEY (`track_spotify_uri`) REFERENCES `tracks`(`spotifyUri`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`artist_spotify_uri`) REFERENCES `artists`(`spotifyUri`) ON UPDATE no action ON DELETE no action
);
