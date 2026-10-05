CREATE TABLE `access_requests` (
	`user_id` text PRIMARY KEY NOT NULL,
	`state` text DEFAULT 'pending' NOT NULL,
	`created` text NOT NULL,
	`reviewed` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
