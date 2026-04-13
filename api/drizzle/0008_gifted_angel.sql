CREATE TABLE `tracks` (
	`spotifyUri` text PRIMARY KEY NOT NULL,
	`createdAt` integer DEFAULT (unixepoch()),
	`name` text NOT NULL,
	`trackNumber` integer,
	`releaseDate` text NOT NULL,
	`totalTracks` integer NOT NULL,
	`albumType` text NOT NULL,
	`imageUrl` text NOT NULL,
	`explicit` integer DEFAULT false,
	`duration` integer DEFAULT 0
);
