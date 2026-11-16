CREATE TABLE `cashflow_items` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`direction` text NOT NULL,
	`amount_cents` integer NOT NULL,
	`frequency` text NOT NULL,
	`source` text DEFAULT 'manual' NOT NULL,
	`linked_contract_id` text,
	`active` integer DEFAULT true NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`linked_contract_id`) REFERENCES `financial_contracts`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "cashflow_items_amount_non_negative" CHECK("cashflow_items"."amount_cents" >= 0)
);
--> statement-breakpoint
CREATE TABLE `documents` (
	`id` text PRIMARY KEY NOT NULL,
	`filename` text NOT NULL,
	`storage_path` text NOT NULL,
	`sha256_hash` text NOT NULL,
	`status` text DEFAULT 'pending_review' NOT NULL,
	`document_type` text DEFAULT 'other' NOT NULL,
	`document_date` text,
	`issuer` text,
	`total_amount_cents` integer,
	`linked_property_id` text,
	`linked_contract_id` text,
	`is_tax_relevant` integer DEFAULT false NOT NULL,
	`tax_year` integer,
	`tax_category` text,
	`deductible_amount_cents` integer,
	`detected_balance_cents` integer,
	`created_at` text NOT NULL,
	FOREIGN KEY (`linked_property_id`) REFERENCES `properties`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`linked_contract_id`) REFERENCES `financial_contracts`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "documents_total_amount_non_negative" CHECK("documents"."total_amount_cents" IS NULL OR "documents"."total_amount_cents" >= 0),
	CONSTRAINT "documents_deductible_amount_non_negative" CHECK("documents"."deductible_amount_cents" IS NULL OR "documents"."deductible_amount_cents" >= 0),
	CONSTRAINT "documents_detected_balance_non_negative" CHECK("documents"."detected_balance_cents" IS NULL OR "documents"."detected_balance_cents" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `documents_sha256_hash_unique` ON `documents` (`sha256_hash`);--> statement-breakpoint
CREATE TABLE `external_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`source` text DEFAULT 'finanz_cockpit' NOT NULL,
	`liquid_cash_cents` integer NOT NULL,
	`etf_stocks_cents` integer NOT NULL,
	`crypto_cents` integer NOT NULL,
	`total_personal_net_worth_cents` integer NOT NULL,
	`fetched_at` text NOT NULL,
	CONSTRAINT "external_snapshots_liquid_cash_non_negative" CHECK("external_snapshots"."liquid_cash_cents" >= 0),
	CONSTRAINT "external_snapshots_etf_stocks_non_negative" CHECK("external_snapshots"."etf_stocks_cents" >= 0),
	CONSTRAINT "external_snapshots_crypto_non_negative" CHECK("external_snapshots"."crypto_cents" >= 0)
);
--> statement-breakpoint
CREATE TABLE `financial_contracts` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`provider` text,
	`sphere` text DEFAULT 'household' NOT NULL,
	`category` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`current_balance_cents` integer NOT NULL,
	`balance_as_of_date` text NOT NULL,
	`monthly_rate_cents` integer DEFAULT 0 NOT NULL,
	`interest_rate_bps` integer DEFAULT 0 NOT NULL,
	`linked_property_id` text,
	`milestone_date` text,
	`milestone_label` text,
	`repayment_type` text,
	`special_repayment_max_yearly_cents` integer,
	`fixed_interest_until` text,
	`target_sum_cents` integer,
	`allocation_threshold_percent` integer,
	`future_loan_interest_rate_bps` integer,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`linked_property_id`) REFERENCES `properties`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "financial_contracts_balance_non_negative" CHECK("financial_contracts"."current_balance_cents" >= 0),
	CONSTRAINT "financial_contracts_monthly_rate_non_negative" CHECK("financial_contracts"."monthly_rate_cents" >= 0),
	CONSTRAINT "financial_contracts_interest_rate_non_negative" CHECK("financial_contracts"."interest_rate_bps" >= 0),
	CONSTRAINT "financial_contracts_allocation_threshold_range" CHECK("financial_contracts"."allocation_threshold_percent" IS NULL OR ("financial_contracts"."allocation_threshold_percent" >= 0 AND "financial_contracts"."allocation_threshold_percent" <= 100))
);
--> statement-breakpoint
CREATE TABLE `pot_allocations` (
	`id` text PRIMARY KEY NOT NULL,
	`pot_id` text NOT NULL,
	`amount_cents` integer NOT NULL,
	`source_label` text NOT NULL,
	`allocated_at` text NOT NULL,
	FOREIGN KEY (`pot_id`) REFERENCES `pots`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "pot_allocations_amount_non_negative" CHECK("pot_allocations"."amount_cents" >= 0)
);
--> statement-breakpoint
CREATE TABLE `pots` (
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
	`updated_at` text NOT NULL,
	FOREIGN KEY (`linked_contract_id`) REFERENCES `financial_contracts`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`linked_property_id`) REFERENCES `properties`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "pots_current_non_negative" CHECK("pots"."current_cents" >= 0),
	CONSTRAINT "pots_target_non_negative" CHECK("pots"."target_cents" IS NULL OR "pots"."target_cents" >= 0),
	CONSTRAINT "pots_fixed_monthly_non_negative" CHECK("pots"."fixed_monthly_cents" IS NULL OR "pots"."fixed_monthly_cents" >= 0),
	CONSTRAINT "pots_remainder_percentage_range" CHECK("pots"."remainder_percentage" IS NULL OR ("pots"."remainder_percentage" >= 0 AND "pots"."remainder_percentage" <= 100))
);
--> statement-breakpoint
CREATE TABLE `properties` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`usage` text DEFAULT 'owner_occupied' NOT NULL,
	`purchase_date` text,
	`purchase_price_cents` integer,
	`estimated_value_cents` integer DEFAULT 0 NOT NULL,
	`maintenance_reserve_pot_id` text,
	`monthly_cold_rent_cents` integer,
	`monthly_non_recoverable_costs_cents` integer,
	`depreciation_basis_cents` integer,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`maintenance_reserve_pot_id`) REFERENCES `pots`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "properties_estimated_value_non_negative" CHECK("properties"."estimated_value_cents" >= 0),
	CONSTRAINT "properties_purchase_price_non_negative" CHECK("properties"."purchase_price_cents" IS NULL OR "properties"."purchase_price_cents" >= 0)
);
