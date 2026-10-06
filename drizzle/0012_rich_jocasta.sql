ALTER TABLE `chain_notes` ADD `edit_token` text;--> statement-breakpoint
ALTER TABLE `users` ADD `dni` text;--> statement-breakpoint
CREATE UNIQUE INDEX `one_dni_per_owner` ON `users` (`created_by`,`dni`);