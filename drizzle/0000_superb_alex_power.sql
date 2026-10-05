CREATE TABLE `admins` (
	`user_id` text PRIMARY KEY NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `chains` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`amount_cents` integer NOT NULL,
	`currency` text NOT NULL,
	`frequency` text NOT NULL,
	`start_date` text NOT NULL,
	`capacity` integer NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`draw_id` text,
	`created` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `members` (
	`chain_id` text NOT NULL,
	`user_id` text NOT NULL,
	`state` text DEFAULT 'pending' NOT NULL,
	`joined` text NOT NULL,
	PRIMARY KEY(`chain_id`, `user_id`),
	FOREIGN KEY (`chain_id`) REFERENCES `chains`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `mobile_codes` (
	`code_hash` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`challenge` text NOT NULL,
	`expires` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `receipts` (
	`id` text PRIMARY KEY NOT NULL,
	`chain_id` text NOT NULL,
	`turn_number` integer NOT NULL,
	`user_id` text NOT NULL,
	`r2_key` text NOT NULL,
	`filename` text NOT NULL,
	`mime` text NOT NULL,
	`state` text DEFAULT 'pending' NOT NULL,
	`uploaded` text NOT NULL,
	`reviewed` text,
	FOREIGN KEY (`chain_id`) REFERENCES `chains`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `one_receipt_per_turn` ON `receipts` (`chain_id`,`turn_number`,`user_id`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`expires` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `turns` (
	`chain_id` text NOT NULL,
	`number` integer NOT NULL,
	`user_id` text NOT NULL,
	`date` text NOT NULL,
	`completed` text,
	PRIMARY KEY(`chain_id`, `number`),
	FOREIGN KEY (`chain_id`) REFERENCES `chains`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `one_turn_per_person` ON `turns` (`chain_id`,`user_id`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`created` text NOT NULL
);
