ALTER TABLE `receipts` ADD `payment_method` text DEFAULT 'transfer' NOT NULL;--> statement-breakpoint
ALTER TABLE `receipts` ADD `paid_date` text;--> statement-breakpoint
ALTER TABLE `receipts` ADD `note` text;--> statement-breakpoint
ALTER TABLE `receipts` ADD `recorded_by` text REFERENCES users(id);