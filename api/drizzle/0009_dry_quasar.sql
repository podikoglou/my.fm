ALTER TABLE `users` ADD `lastRecentTracksFetchTime` integer;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_scrobbles` (
	`id` text PRIMARY KEY NOT NULL,
	`createdAt` integer DEFAULT (unixepoch()),
	`userId` text NOT NULL,
	`trackSpotifyUri` text NOT NULL,
	`albumSpotifyUri` text NOT NULL,
	`scrobbleDate` integer,
	FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`trackSpotifyUri`) REFERENCES `tracks`(`spotifyUri`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`albumSpotifyUri`) REFERENCES `albums`(`spotifyUri`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_scrobbles`("id", "createdAt", "userId", "trackSpotifyUri", "albumSpotifyUri", "scrobbleDate") SELECT "id", "createdAt", "userId", "trackSpotifyUri", "albumSpotifyUri", "scrobbleDate" FROM `scrobbles`;--> statement-breakpoint
DROP TABLE `scrobbles`;--> statement-breakpoint
ALTER TABLE `__new_scrobbles` RENAME TO `scrobbles`;--> statement-breakpoint
PRAGMA foreign_keys=ON;