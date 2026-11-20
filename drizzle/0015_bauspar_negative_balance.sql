PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_documents` (
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
	`extracted_contract_json` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`linked_property_id`) REFERENCES `properties`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`linked_contract_id`) REFERENCES `financial_contracts`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "documents_total_amount_non_negative" CHECK("__new_documents"."total_amount_cents" IS NULL OR "__new_documents"."total_amount_cents" >= 0),
	CONSTRAINT "documents_deductible_amount_non_negative" CHECK("__new_documents"."deductible_amount_cents" IS NULL OR "__new_documents"."deductible_amount_cents" >= 0)
);
--> statement-breakpoint
INSERT INTO `__new_documents`("id", "filename", "storage_path", "sha256_hash", "status", "document_type", "document_date", "issuer", "total_amount_cents", "linked_property_id", "linked_contract_id", "is_tax_relevant", "tax_year", "tax_category", "deductible_amount_cents", "detected_balance_cents", "extracted_contract_json", "created_at") SELECT "id", "filename", "storage_path", "sha256_hash", "status", "document_type", "document_date", "issuer", "total_amount_cents", "linked_property_id", "linked_contract_id", "is_tax_relevant", "tax_year", "tax_category", "deductible_amount_cents", "detected_balance_cents", "extracted_contract_json", "created_at" FROM `documents`;--> statement-breakpoint
DROP TABLE `documents`;--> statement-breakpoint
ALTER TABLE `__new_documents` RENAME TO `documents`;--> statement-breakpoint
CREATE UNIQUE INDEX `documents_sha256_hash_unique` ON `documents` (`sha256_hash`);--> statement-breakpoint
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
	CONSTRAINT "financial_contracts_balance_sign" CHECK("__new_financial_contracts"."category" = 'savings_contract' OR "__new_financial_contracts"."current_balance_cents" >= 0),
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
INSERT INTO `__new_financial_contracts`("id", "name", "provider", "sphere", "category", "status", "current_balance_cents", "balance_as_of_date", "monthly_rate_cents", "interest_rate_bps", "linked_property_id", "milestone_date", "milestone_label", "repayment_type", "original_principal_cents", "special_repayment_right", "special_repayment_basis", "special_repayment_max_yearly_cents", "special_repayment_percent_bps", "special_repayment_used_cents", "special_repayment_used_year", "rate_change_right", "rate_change_total_count", "rate_change_scope", "rate_change_used_count", "rate_change_min_repayment_bps", "rate_change_max_repayment_bps", "rate_change_min_monthly_cents", "rate_change_max_monthly_cents", "loan_options_note", "fixed_interest_until", "target_sum_cents", "allocation_threshold_percent", "future_loan_interest_rate_bps", "updated_at") SELECT "id", "name", "provider", "sphere", "category", "status", "current_balance_cents", "balance_as_of_date", "monthly_rate_cents", "interest_rate_bps", "linked_property_id", "milestone_date", "milestone_label", "repayment_type", "original_principal_cents", "special_repayment_right", "special_repayment_basis", "special_repayment_max_yearly_cents", "special_repayment_percent_bps", "special_repayment_used_cents", "special_repayment_used_year", "rate_change_right", "rate_change_total_count", "rate_change_scope", "rate_change_used_count", "rate_change_min_repayment_bps", "rate_change_max_repayment_bps", "rate_change_min_monthly_cents", "rate_change_max_monthly_cents", "loan_options_note", "fixed_interest_until", "target_sum_cents", "allocation_threshold_percent", "future_loan_interest_rate_bps", "updated_at" FROM `financial_contracts`;--> statement-breakpoint
DROP TABLE `financial_contracts`;--> statement-breakpoint
ALTER TABLE `__new_financial_contracts` RENAME TO `financial_contracts`;--> statement-breakpoint
PRAGMA foreign_keys=ON;
