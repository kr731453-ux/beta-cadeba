CREATE TABLE `turn_shares` (
	`chain_id` text NOT NULL,
	`turn_number` integer NOT NULL,
	`user_id` text NOT NULL,
	`slot_number` integer NOT NULL,
	`half_units` integer NOT NULL,
	`position` integer NOT NULL,
	PRIMARY KEY(`chain_id`, `turn_number`, `user_id`, `slot_number`),
	FOREIGN KEY (`chain_id`) REFERENCES `chains`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `one_collection_per_share` ON `turn_shares` (`chain_id`,`user_id`,`slot_number`);--> statement-breakpoint
ALTER TABLE `members` ADD `half_units` integer;
--> statement-breakpoint
CREATE TRIGGER turn_shares_archived_insert BEFORE INSERT ON turn_shares WHEN EXISTS(SELECT 1 FROM chains WHERE id=NEW.chain_id AND archived_at IS NOT NULL) BEGIN SELECT RAISE(ABORT,'CHAIN_ARCHIVED'); END;
--> statement-breakpoint
CREATE TRIGGER turn_shares_archived_update BEFORE UPDATE ON turn_shares WHEN EXISTS(SELECT 1 FROM chains WHERE id=NEW.chain_id AND archived_at IS NOT NULL) BEGIN SELECT RAISE(ABORT,'CHAIN_ARCHIVED'); END;
