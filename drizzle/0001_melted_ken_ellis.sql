DROP INDEX `one_receipt_per_turn`;--> statement-breakpoint
ALTER TABLE `receipts` ADD `slot_number` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `one_receipt_per_turn_slot` ON `receipts` (`chain_id`,`turn_number`,`user_id`,`slot_number`);--> statement-breakpoint
DROP INDEX `one_turn_per_person`;--> statement-breakpoint
ALTER TABLE `turns` ADD `slot_number` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `one_turn_per_slot` ON `turns` (`chain_id`,`user_id`,`slot_number`);--> statement-breakpoint
ALTER TABLE `members` ADD `quantity` integer DEFAULT 1 NOT NULL;