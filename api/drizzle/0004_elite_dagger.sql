PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_users` (
	`id` text PRIMARY KEY NOT NULL,
	`username` text NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`createdAt` integer DEFAULT (unixepoch()),
	`spotifyAccessToken` text,
	`spotifyRefreshToken` text,
	`spotifyTokenExpiration` text,
	`onboarded` integer
);
--> statement-breakpoint
INSERT INTO `__new_users`("id", "username", "name", "email", "createdAt", "spotifyAccessToken", "spotifyRefreshToken", "spotifyTokenExpiration", "onboarded") SELECT "id", "username", "name", "email", "createdAt", "spotifyAccessToken", "spotifyRefreshToken", "spotifyTokenExpiration", "onboarded" FROM `users`;--> statement-breakpoint
DROP TABLE `users`;--> statement-breakpoint
ALTER TABLE `__new_users` RENAME TO `users`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `users_username_unique` ON `users` (`username`);