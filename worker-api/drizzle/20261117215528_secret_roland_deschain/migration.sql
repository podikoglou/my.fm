CREATE TABLE `imports` (
	`id` text PRIMARY KEY,
	`userId` text NOT NULL,
	`filename` text NOT NULL,
	`r2Key` text NOT NULL,
	`status` text NOT NULL,
	`cursor` integer DEFAULT 0 NOT NULL,
	`totalLines` integer,
	`processedRows` integer DEFAULT 0 NOT NULL,
	`skippedRows` integer DEFAULT 0 NOT NULL,
	`error` text,
	`createdAt` integer DEFAULT (unixepoch()),
	`updatedAt` integer NOT NULL,
	CONSTRAINT `fk_imports_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
ALTER TABLE `scrobbles` ADD `coverArtUrl` text;--> statement-breakpoint
ALTER TABLE `scrobbles` ADD `artistName` text;--> statement-breakpoint
ALTER TABLE `scrobbles` ADD `albumName` text;--> statement-breakpoint
ALTER TABLE `scrobbles` ADD `trackName` text;--> statement-breakpoint
ALTER TABLE `scrobbles` ADD `normArtistKey` text;--> statement-breakpoint
ALTER TABLE `scrobbles` ADD `normTrackKey` text;--> statement-breakpoint
ALTER TABLE `scrobbles` ADD `importId` text REFERENCES imports(id) ON DELETE CASCADE;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_scrobbles` (
	`id` text PRIMARY KEY,
	`createdAt` integer DEFAULT (unixepoch()),
	`userId` text NOT NULL,
	`trackSpotifyUri` text,
	`albumSpotifyUri` text,
	`coverArtUrl` text,
	`artistName` text,
	`albumName` text,
	`trackName` text,
	`normArtistKey` text,
	`normTrackKey` text,
	`scrobbleDate` integer,
	`importId` text,
	CONSTRAINT `fk_scrobbles_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_scrobbles_trackSpotifyUri_tracks_spotifyUri_fk` FOREIGN KEY (`trackSpotifyUri`) REFERENCES `tracks`(`spotifyUri`),
	CONSTRAINT `fk_scrobbles_albumSpotifyUri_albums_spotifyUri_fk` FOREIGN KEY (`albumSpotifyUri`) REFERENCES `albums`(`spotifyUri`),
	CONSTRAINT `fk_scrobbles_importId_imports_id_fk` FOREIGN KEY (`importId`) REFERENCES `imports`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
INSERT INTO `__new_scrobbles`(`id`, `createdAt`, `userId`, `trackSpotifyUri`, `albumSpotifyUri`, `scrobbleDate`) SELECT `id`, `createdAt`, `userId`, `trackSpotifyUri`, `albumSpotifyUri`, `scrobbleDate` FROM `scrobbles`;--> statement-breakpoint
DROP TABLE `scrobbles`;--> statement-breakpoint
ALTER TABLE `__new_scrobbles` RENAME TO `scrobbles`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `scrobbles_scrobble_date_id_idx` ON `scrobbles` (`scrobbleDate`,`id`);--> statement-breakpoint
CREATE INDEX `scrobbles_user_id_scrobble_date_idx` ON `scrobbles` (`userId`,`scrobbleDate`);--> statement-breakpoint
CREATE INDEX `scrobbles_norm_track_key_idx` ON `scrobbles` (`normTrackKey`);--> statement-breakpoint
CREATE INDEX `scrobbles_import_id_idx` ON `scrobbles` (`importId`);--> statement-breakpoint
CREATE INDEX `imports_status_created_at_idx` ON `imports` (`status`,`createdAt`);--> statement-breakpoint
CREATE INDEX `imports_user_id_idx` ON `imports` (`userId`);