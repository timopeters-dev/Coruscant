ALTER TABLE `external_snapshots` ADD `accounts_json` text;--> statement-breakpoint
ALTER TABLE `external_snapshots` ADD `positions_json` text;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_pots` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`priority` integer NOT NULL,
	`current_cents` integer DEFAULT 0 NOT NULL,
	`target_cents` integer,
	`rule_type` text NOT NULL,
	`fixed_monthly_cents` integer,
	`remainder_percentage` integer,
	`linked_contract_id` text,
	`linked_property_id` text,
	`external_link_kind` text,
	`external_link_ref` text,
	`external_link_scope` text,
	`external_synced_at` text,
	`external_linked_at` text,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`linked_contract_id`) REFERENCES `financial_contracts`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`linked_property_id`) REFERENCES `properties`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "pots_external_link_pair" CHECK(("__new_pots"."external_link_kind" IS NULL AND "__new_pots"."external_link_ref" IS NULL) OR ("__new_pots"."external_link_kind" IS NOT NULL AND "__new_pots"."external_link_ref" IS NOT NULL)),
	CONSTRAINT "pots_current_non_negative" CHECK("__new_pots"."current_cents" >= 0),
	CONSTRAINT "pots_target_non_negative" CHECK("__new_pots"."target_cents" IS NULL OR "__new_pots"."target_cents" >= 0),
	CONSTRAINT "pots_fixed_monthly_non_negative" CHECK("__new_pots"."fixed_monthly_cents" IS NULL OR "__new_pots"."fixed_monthly_cents" >= 0),
	CONSTRAINT "pots_remainder_percentage_range" CHECK("__new_pots"."remainder_percentage" IS NULL OR ("__new_pots"."remainder_percentage" >= 0 AND "__new_pots"."remainder_percentage" <= 100))
);
--> statement-breakpoint
INSERT INTO `__new_pots`("id", "name", "priority", "current_cents", "target_cents", "rule_type", "fixed_monthly_cents", "remainder_percentage", "linked_contract_id", "linked_property_id", "updated_at") SELECT "id", "name", "priority", "current_cents", "target_cents", "rule_type", "fixed_monthly_cents", "remainder_percentage", "linked_contract_id", "linked_property_id", "updated_at" FROM `pots`;--> statement-breakpoint
DROP TABLE `pots`;--> statement-breakpoint
ALTER TABLE `__new_pots` RENAME TO `pots`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `pots_external_link_unique` ON `pots` (`external_link_kind`,`external_link_ref`);