PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_users` (
	`id` text PRIMARY KEY NOT NULL,
	`username` text NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`createdAt` integer DEFAULT (unixepoch()),
	`avatarUrl` text,
	`spotifyAccessToken` text,
	`spotifyRefreshToken` text,
	`spotifyTokenExpiration` integer,
	`lastRecentTracksFetchTime` integer,
	`onboarded` integer
);
--> statement-breakpoint
INSERT INTO `__new_users`("id", "username", "name", "email", "createdAt", "avatarUrl", "spotifyAccessToken", "spotifyRefreshToken", "spotifyTokenExpiration", "lastRecentTracksFetchTime", "onboarded") SELECT "id", "username", "name", "email", "createdAt", "avatarUrl", "spotifyAccessToken", "spotifyRefreshToken", "spotifyTokenExpiration", "lastRecentTracksFetchTime", "onboarded" FROM `users`;--> statement-breakpoint
DROP TABLE `users`;--> statement-breakpoint
ALTER TABLE `__new_users` RENAME TO `users`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `users_username_unique` ON `users` (`username`);--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);