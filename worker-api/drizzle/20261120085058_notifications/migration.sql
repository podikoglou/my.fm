CREATE TABLE `notifications` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
	`userId` text NOT NULL,
	`type` text NOT NULL,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`createdAt` integer DEFAULT (unixepoch()) NOT NULL,
	`acknowledgedAt` integer,
	CONSTRAINT `fk_notifications_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX `notifications_user_id_idx` ON `notifications` (`userId`);