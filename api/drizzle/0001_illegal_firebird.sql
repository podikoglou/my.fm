CREATE TABLE `scrobbles` (
	`id` text PRIMARY KEY NOT NULL,
	`createdAt` integer,
	`userId` text NOT NULL,
	`spotifyUri` text NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
