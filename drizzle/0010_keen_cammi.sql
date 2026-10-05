CREATE TABLE `extra_deliveries` (
	`id` text PRIMARY KEY NOT NULL,
	`chain_id` text NOT NULL,
	`turn_number` integer NOT NULL,
	`user_id` text NOT NULL,
	`amount_cents` integer NOT NULL,
	`paid_date` text NOT NULL,
	`note` text,
	`recorded_by` text NOT NULL,
	`created` text NOT NULL,
	FOREIGN KEY (`chain_id`) REFERENCES `chains`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`recorded_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
ALTER TABLE `chains` ADD `revision` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `chains` ADD `edit_token` text;--> statement-breakpoint
ALTER TABLE `members` ADD `added_after_turn` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `receipts` ADD `is_arrear` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `turns` ADD `fund_cents` integer;
--> statement-breakpoint
UPDATE turns SET fund_cents=(SELECT COALESCE(SUM(COALESCE(r.amount_cents,c.amount_cents)),0) FROM receipts r JOIN chains c ON c.id=r.chain_id WHERE r.chain_id=turns.chain_id AND r.turn_number=turns.number AND r.state='approved') WHERE completed IS NOT NULL AND EXISTS(SELECT 1 FROM chains c WHERE c.id=turns.chain_id AND c.archived_at IS NULL);
--> statement-breakpoint
CREATE TRIGGER extra_deliveries_archived_insert BEFORE INSERT ON extra_deliveries WHEN EXISTS(SELECT 1 FROM chains WHERE id=NEW.chain_id AND archived_at IS NOT NULL) BEGIN SELECT RAISE(ABORT,'CHAIN_ARCHIVED'); END;
