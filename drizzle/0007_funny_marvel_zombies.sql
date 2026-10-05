CREATE TABLE `file_deletions` (
	`key` text PRIMARY KEY NOT NULL,
	`created` text NOT NULL
);
--> statement-breakpoint
ALTER TABLE `chains` ADD `archived_at` text;
--> statement-breakpoint
CREATE TRIGGER members_archived_insert BEFORE INSERT ON members WHEN EXISTS(SELECT 1 FROM chains WHERE id=NEW.chain_id AND archived_at IS NOT NULL) BEGIN SELECT RAISE(ABORT,'CHAIN_ARCHIVED'); END;

--> statement-breakpoint
CREATE TRIGGER members_archived_update BEFORE UPDATE ON members WHEN EXISTS(SELECT 1 FROM chains WHERE id=NEW.chain_id AND archived_at IS NOT NULL) BEGIN SELECT RAISE(ABORT,'CHAIN_ARCHIVED'); END;

--> statement-breakpoint
CREATE TRIGGER turns_archived_insert BEFORE INSERT ON turns WHEN EXISTS(SELECT 1 FROM chains WHERE id=NEW.chain_id AND archived_at IS NOT NULL) BEGIN SELECT RAISE(ABORT,'CHAIN_ARCHIVED'); END;

--> statement-breakpoint
CREATE TRIGGER turns_archived_update BEFORE UPDATE ON turns WHEN EXISTS(SELECT 1 FROM chains WHERE id=NEW.chain_id AND archived_at IS NOT NULL) BEGIN SELECT RAISE(ABORT,'CHAIN_ARCHIVED'); END;

--> statement-breakpoint
CREATE TRIGGER receipts_archived_insert BEFORE INSERT ON receipts WHEN EXISTS(SELECT 1 FROM chains WHERE id=NEW.chain_id AND archived_at IS NOT NULL) BEGIN SELECT RAISE(ABORT,'CHAIN_ARCHIVED'); END;

--> statement-breakpoint
CREATE TRIGGER receipts_archived_update BEFORE UPDATE ON receipts WHEN EXISTS(SELECT 1 FROM chains WHERE id=NEW.chain_id AND archived_at IS NOT NULL) BEGIN SELECT RAISE(ABORT,'CHAIN_ARCHIVED'); END;

--> statement-breakpoint
CREATE TRIGGER dues_archived_insert BEFORE INSERT ON dues WHEN EXISTS(SELECT 1 FROM chains WHERE id=NEW.chain_id AND archived_at IS NOT NULL) BEGIN SELECT RAISE(ABORT,'CHAIN_ARCHIVED'); END;

--> statement-breakpoint
CREATE TRIGGER dues_archived_update BEFORE UPDATE ON dues WHEN EXISTS(SELECT 1 FROM chains WHERE id=NEW.chain_id AND archived_at IS NOT NULL) BEGIN SELECT RAISE(ABORT,'CHAIN_ARCHIVED'); END;

--> statement-breakpoint
CREATE TRIGGER chains_archived_status BEFORE UPDATE OF status,draw_id ON chains WHEN OLD.archived_at IS NOT NULL BEGIN SELECT RAISE(ABORT,'CHAIN_ARCHIVED'); END;
