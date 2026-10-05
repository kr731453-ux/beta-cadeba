CREATE TABLE `admin_credentials` (
	`user_id` text PRIMARY KEY NOT NULL,
	`username` text NOT NULL,
	`digest` text NOT NULL,
	`salt` text NOT NULL,
	`updated` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `admin_credentials_username_unique` ON `admin_credentials` (`username`);--> statement-breakpoint
CREATE TABLE `dues` (
	`chain_id` text NOT NULL,
	`user_id` text NOT NULL,
	`turn_number` integer NOT NULL,
	`amount_cents` integer NOT NULL,
	`updated` text NOT NULL,
	PRIMARY KEY(`chain_id`, `user_id`, `turn_number`),
	FOREIGN KEY (`chain_id`) REFERENCES `chains`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
ALTER TABLE `receipts` ADD `amount_cents` integer;--> statement-breakpoint
ALTER TABLE `receipts` ADD `group_id` text;