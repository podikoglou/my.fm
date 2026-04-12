CREATE TABLE `scrobbles` (
	`id` text PRIMARY KEY NOT NULL,
	`createdAt` integer,
	`userId` text NOT NULL,
	`spotifyUri` text NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `users` (
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
CREATE UNIQUE INDEX `users_username_unique` ON `users` (`username`);