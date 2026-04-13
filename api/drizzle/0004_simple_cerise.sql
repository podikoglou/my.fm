PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_scrobbles` (
	`id` text PRIMARY KEY NOT NULL,
	`createdAt` integer DEFAULT (unixepoch()),
	`userId` text NOT NULL,
	`spotifyUri` text NOT NULL,
	`scrobbleDate` integer,
	FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_scrobbles`("id", "createdAt", "userId", "spotifyUri", "scrobbleDate") SELECT "id", "createdAt", "userId", "spotifyUri", "scrobbleDate" FROM `scrobbles`;--> statement-breakpoint
DROP TABLE `scrobbles`;--> statement-breakpoint
ALTER TABLE `__new_scrobbles` RENAME TO `scrobbles`;--> statement-breakpoint
PRAGMA foreign_keys=ON;