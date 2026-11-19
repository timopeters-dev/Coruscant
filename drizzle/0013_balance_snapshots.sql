CREATE TABLE `balance_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`snapshot_date` text NOT NULL,
	`total_assets_cents` integer NOT NULL,
	`liabilities_cents` integer NOT NULL,
	`net_worth_cents` integer NOT NULL,
	`free_assets_cents` integer NOT NULL,
	`bound_assets_cents` integer NOT NULL,
	`properties_value_cents` integer NOT NULL,
	`savings_contracts_value_cents` integer NOT NULL,
	`has_modeled_values` integer NOT NULL,
	`trigger` text NOT NULL,
	`captured_at` text NOT NULL,
	CONSTRAINT "balance_snapshots_total_assets_non_negative" CHECK("balance_snapshots"."total_assets_cents" >= 0),
	CONSTRAINT "balance_snapshots_liabilities_non_negative" CHECK("balance_snapshots"."liabilities_cents" >= 0),
	CONSTRAINT "balance_snapshots_free_assets_non_negative" CHECK("balance_snapshots"."free_assets_cents" >= 0),
	CONSTRAINT "balance_snapshots_bound_assets_non_negative" CHECK("balance_snapshots"."bound_assets_cents" >= 0),
	CONSTRAINT "balance_snapshots_properties_value_non_negative" CHECK("balance_snapshots"."properties_value_cents" >= 0),
	CONSTRAINT "balance_snapshots_savings_contracts_non_negative" CHECK("balance_snapshots"."savings_contracts_value_cents" >= 0),
	CONSTRAINT "balance_snapshots_total_equals_free_plus_bound" CHECK("balance_snapshots"."total_assets_cents" = "balance_snapshots"."free_assets_cents" + "balance_snapshots"."bound_assets_cents"),
	CONSTRAINT "balance_snapshots_bound_equals_properties_plus_savings" CHECK("balance_snapshots"."bound_assets_cents" = "balance_snapshots"."properties_value_cents" + "balance_snapshots"."savings_contracts_value_cents"),
	CONSTRAINT "balance_snapshots_net_equals_total_minus_liabilities" CHECK("balance_snapshots"."net_worth_cents" = "balance_snapshots"."total_assets_cents" - "balance_snapshots"."liabilities_cents"),
	CONSTRAINT "balance_snapshots_snapshot_date_format" CHECK("balance_snapshots"."snapshot_date" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `balance_snapshots_snapshot_date_unique` ON `balance_snapshots` (`snapshot_date`);