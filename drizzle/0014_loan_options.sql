PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_financial_contracts` (
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
	`original_principal_cents` integer,
	`special_repayment_right` text DEFAULT 'unknown' NOT NULL,
	`special_repayment_basis` text,
	`special_repayment_max_yearly_cents` integer,
	`special_repayment_percent_bps` integer,
	`special_repayment_used_cents` integer,
	`special_repayment_used_year` integer,
	`rate_change_right` text DEFAULT 'unknown' NOT NULL,
	`rate_change_total_count` integer,
	`rate_change_scope` text,
	`rate_change_used_count` integer DEFAULT 0 NOT NULL,
	`rate_change_min_repayment_bps` integer,
	`rate_change_max_repayment_bps` integer,
	`rate_change_min_monthly_cents` integer,
	`rate_change_max_monthly_cents` integer,
	`loan_options_note` text,
	`fixed_interest_until` text,
	`target_sum_cents` integer,
	`allocation_threshold_percent` integer,
	`future_loan_interest_rate_bps` integer,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`linked_property_id`) REFERENCES `properties`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "financial_contracts_balance_non_negative" CHECK("__new_financial_contracts"."current_balance_cents" >= 0),
	CONSTRAINT "financial_contracts_monthly_rate_non_negative" CHECK("__new_financial_contracts"."monthly_rate_cents" >= 0),
	CONSTRAINT "financial_contracts_interest_rate_non_negative" CHECK("__new_financial_contracts"."interest_rate_bps" >= 0),
	CONSTRAINT "financial_contracts_allocation_threshold_range" CHECK("__new_financial_contracts"."allocation_threshold_percent" IS NULL OR ("__new_financial_contracts"."allocation_threshold_percent" >= 0 AND "__new_financial_contracts"."allocation_threshold_percent" <= 100)),
	CONSTRAINT "financial_contracts_original_principal_positive" CHECK("__new_financial_contracts"."original_principal_cents" IS NULL OR "__new_financial_contracts"."original_principal_cents" > 0),
	CONSTRAINT "financial_contracts_special_repayment_percent_bps_range" CHECK("__new_financial_contracts"."special_repayment_percent_bps" IS NULL OR ("__new_financial_contracts"."special_repayment_percent_bps" > 0 AND "__new_financial_contracts"."special_repayment_percent_bps" <= 10000)),
	CONSTRAINT "financial_contracts_special_repayment_used_non_negative" CHECK("__new_financial_contracts"."special_repayment_used_cents" IS NULL OR "__new_financial_contracts"."special_repayment_used_cents" >= 0),
	CONSTRAINT "financial_contracts_special_repayment_used_pair" CHECK(("__new_financial_contracts"."special_repayment_used_cents" IS NULL AND "__new_financial_contracts"."special_repayment_used_year" IS NULL) OR ("__new_financial_contracts"."special_repayment_used_cents" IS NOT NULL AND "__new_financial_contracts"."special_repayment_used_year" IS NOT NULL)),
	CONSTRAINT "financial_contracts_rate_change_total_count_range" CHECK("__new_financial_contracts"."rate_change_total_count" IS NULL OR ("__new_financial_contracts"."rate_change_total_count" >= 1 AND "__new_financial_contracts"."rate_change_total_count" <= 50)),
	CONSTRAINT "financial_contracts_rate_change_used_count_non_negative" CHECK("__new_financial_contracts"."rate_change_used_count" >= 0),
	CONSTRAINT "financial_contracts_rate_change_min_repayment_bps_range" CHECK("__new_financial_contracts"."rate_change_min_repayment_bps" IS NULL OR ("__new_financial_contracts"."rate_change_min_repayment_bps" >= 0 AND "__new_financial_contracts"."rate_change_min_repayment_bps" <= 10000)),
	CONSTRAINT "financial_contracts_rate_change_max_repayment_bps_range" CHECK("__new_financial_contracts"."rate_change_max_repayment_bps" IS NULL OR ("__new_financial_contracts"."rate_change_max_repayment_bps" >= 0 AND "__new_financial_contracts"."rate_change_max_repayment_bps" <= 10000)),
	CONSTRAINT "financial_contracts_rate_change_min_monthly_non_negative" CHECK("__new_financial_contracts"."rate_change_min_monthly_cents" IS NULL OR "__new_financial_contracts"."rate_change_min_monthly_cents" >= 0),
	CONSTRAINT "financial_contracts_rate_change_max_monthly_non_negative" CHECK("__new_financial_contracts"."rate_change_max_monthly_cents" IS NULL OR "__new_financial_contracts"."rate_change_max_monthly_cents" >= 0)
);
--> statement-breakpoint
INSERT INTO `__new_financial_contracts`("id", "name", "provider", "sphere", "category", "status", "current_balance_cents", "balance_as_of_date", "monthly_rate_cents", "interest_rate_bps", "linked_property_id", "milestone_date", "milestone_label", "repayment_type", "original_principal_cents", "special_repayment_right", "special_repayment_basis", "special_repayment_max_yearly_cents", "special_repayment_percent_bps", "special_repayment_used_cents", "special_repayment_used_year", "rate_change_right", "rate_change_total_count", "rate_change_scope", "rate_change_used_count", "rate_change_min_repayment_bps", "rate_change_max_repayment_bps", "rate_change_min_monthly_cents", "rate_change_max_monthly_cents", "loan_options_note", "fixed_interest_until", "target_sum_cents", "allocation_threshold_percent", "future_loan_interest_rate_bps", "updated_at") SELECT "id", "name", "provider", "sphere", "category", "status", "current_balance_cents", "balance_as_of_date", "monthly_rate_cents", "interest_rate_bps", "linked_property_id", "milestone_date", "milestone_label", "repayment_type", NULL, 'unknown', NULL, "special_repayment_max_yearly_cents", NULL, NULL, NULL, 'unknown', NULL, NULL, 0, NULL, NULL, NULL, NULL, NULL, "fixed_interest_until", "target_sum_cents", "allocation_threshold_percent", "future_loan_interest_rate_bps", "updated_at" FROM `financial_contracts`;--> statement-breakpoint
DROP TABLE `financial_contracts`;--> statement-breakpoint
ALTER TABLE `__new_financial_contracts` RENAME TO `financial_contracts`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
UPDATE `financial_contracts` SET `special_repayment_right` = CASE
  WHEN `category` <> 'loan' OR `special_repayment_max_yearly_cents` IS NULL THEN 'unknown'
  WHEN `special_repayment_max_yearly_cents` = 0 THEN 'none'
  ELSE 'allowed' END;--> statement-breakpoint
UPDATE `financial_contracts` SET `special_repayment_basis` = 'fixed_yearly'
  WHERE `special_repayment_right` = 'allowed';--> statement-breakpoint
UPDATE `financial_contracts` SET `special_repayment_max_yearly_cents` = NULL
  WHERE `special_repayment_right` = 'none';