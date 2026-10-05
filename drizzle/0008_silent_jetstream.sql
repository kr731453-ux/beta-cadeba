CREATE TABLE `account_requests` (
	`user_id` text PRIMARY KEY NOT NULL,
	`state` text DEFAULT 'pending' NOT NULL,
	`created` text NOT NULL,
	`reviewed` text,
	`reviewed_by` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`reviewed_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
ALTER TABLE `admins` ADD `role` text DEFAULT 'manager' NOT NULL;--> statement-breakpoint
ALTER TABLE `chains` ADD `owner_id` text REFERENCES users(id);--> statement-breakpoint
ALTER TABLE `users` ADD `created_by` text;
--> statement-breakpoint
UPDATE admins SET role='owner';
--> statement-breakpoint
UPDATE chains SET owner_id=(SELECT user_id FROM admins ORDER BY user_id LIMIT 1) WHERE owner_id IS NULL;
--> statement-breakpoint
UPDATE users SET created_by=(SELECT user_id FROM admins ORDER BY user_id LIMIT 1) WHERE created_by IS NULL AND NOT EXISTS(SELECT 1 FROM admins WHERE admins.user_id=users.id);
