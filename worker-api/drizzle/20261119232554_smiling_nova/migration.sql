DROP INDEX IF EXISTS `scrobbles_user_id_scrobble_date_idx`;--> statement-breakpoint
CREATE INDEX `scrobbles_user_id_scrobble_date_id_idx` ON `scrobbles` (`userId`,`scrobbleDate`,`id`);