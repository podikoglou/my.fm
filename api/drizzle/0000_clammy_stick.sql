CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`username` text NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`createdAt` integer,
	`spotifyAccessCode` text,
	`spotifyRefreshToken` text,
	`spotifyTokenExpiration` text,
	`onboarded` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_username_unique` ON `users` (`username`);