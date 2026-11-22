CREATE TABLE `accounts` (
	`id` text PRIMARY KEY,
	`account_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`user_id` text NOT NULL,
	`access_token` text,
	`refresh_token` text,
	`id_token` text,
	`access_token_expires_at` integer,
	`refresh_token_expires_at` integer,
	`scope` text,
	`password` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT `fk_accounts_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `album_artists` (
	`album_spotify_uri` text NOT NULL,
	`artist_spotify_uri` text NOT NULL,
	`position` integer NOT NULL,
	CONSTRAINT `album_artists_pk` PRIMARY KEY(`album_spotify_uri`, `artist_spotify_uri`),
	CONSTRAINT `fk_album_artists_album_spotify_uri_albums_spotifyUri_fk` FOREIGN KEY (`album_spotify_uri`) REFERENCES `albums`(`spotifyUri`),
	CONSTRAINT `fk_album_artists_artist_spotify_uri_artists_spotifyUri_fk` FOREIGN KEY (`artist_spotify_uri`) REFERENCES `artists`(`spotifyUri`)
);
--> statement-breakpoint
CREATE TABLE `albums` (
	`spotifyUri` text PRIMARY KEY,
	`createdAt` integer DEFAULT (unixepoch()),
	`name` text NOT NULL,
	`releaseDate` text NOT NULL,
	`totalTracks` integer NOT NULL,
	`albumType` text NOT NULL,
	`imageUrl` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `artists` (
	`spotifyUri` text PRIMARY KEY,
	`createdAt` integer DEFAULT (unixepoch()),
	`name` text NOT NULL,
	`imageUrl` text
);
--> statement-breakpoint
CREATE TABLE `scrobbles` (
	`id` text PRIMARY KEY,
	`createdAt` integer DEFAULT (unixepoch()),
	`userId` text NOT NULL,
	`trackSpotifyUri` text NOT NULL,
	`albumSpotifyUri` text NOT NULL,
	`scrobbleDate` integer,
	CONSTRAINT `fk_scrobbles_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`),
	CONSTRAINT `fk_scrobbles_trackSpotifyUri_tracks_spotifyUri_fk` FOREIGN KEY (`trackSpotifyUri`) REFERENCES `tracks`(`spotifyUri`),
	CONSTRAINT `fk_scrobbles_albumSpotifyUri_albums_spotifyUri_fk` FOREIGN KEY (`albumSpotifyUri`) REFERENCES `albums`(`spotifyUri`)
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY,
	`expires_at` integer NOT NULL,
	`token` text NOT NULL UNIQUE,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`ip_address` text,
	`user_agent` text,
	`user_id` text NOT NULL,
	CONSTRAINT `fk_sessions_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `track_artists` (
	`track_spotify_uri` text NOT NULL,
	`artist_spotify_uri` text NOT NULL,
	`position` integer NOT NULL,
	CONSTRAINT `track_artists_pk` PRIMARY KEY(`track_spotify_uri`, `artist_spotify_uri`),
	CONSTRAINT `fk_track_artists_track_spotify_uri_tracks_spotifyUri_fk` FOREIGN KEY (`track_spotify_uri`) REFERENCES `tracks`(`spotifyUri`),
	CONSTRAINT `fk_track_artists_artist_spotify_uri_artists_spotifyUri_fk` FOREIGN KEY (`artist_spotify_uri`) REFERENCES `artists`(`spotifyUri`)
);
--> statement-breakpoint
CREATE TABLE `tracks` (
	`spotifyUri` text PRIMARY KEY,
	`createdAt` integer DEFAULT (unixepoch()),
	`name` text NOT NULL,
	`trackNumber` integer,
	`releaseDate` text NOT NULL,
	`imageUrl` text NOT NULL,
	`explicit` integer DEFAULT false,
	`duration` integer DEFAULT 0
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY,
	`username` text NOT NULL UNIQUE,
	`name` text NOT NULL,
	`email` text NOT NULL UNIQUE,
	`email_verified` integer DEFAULT false NOT NULL,
	`createdAt` integer DEFAULT (unixepoch()),
	`updated_at` integer NOT NULL,
	`avatarUrl` text,
	`lastRecentTracksFetchTime` integer,
	`onboarded` integer
);
--> statement-breakpoint
CREATE TABLE `verification` (
	`id` text PRIMARY KEY,
	`identifier` text NOT NULL,
	`value` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `account_userId_idx` ON `accounts` (`user_id`);--> statement-breakpoint
CREATE INDEX `session_userId_idx` ON `sessions` (`user_id`);--> statement-breakpoint
CREATE INDEX `verification_identifier_idx` ON `verification` (`identifier`);