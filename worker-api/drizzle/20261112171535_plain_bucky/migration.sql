CREATE TABLE `ingestion_runs` (
	`id` integer PRIMARY KEY,
	`lastRunAt` integer NOT NULL,
	`status` text NOT NULL
);
