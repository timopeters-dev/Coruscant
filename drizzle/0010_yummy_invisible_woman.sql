CREATE TABLE `property_valuation_history` (
	`id` text PRIMARY KEY NOT NULL,
	`property_id` text NOT NULL,
	`valued_at` text NOT NULL,
	`data_as_of` text,
	`lower_cents` integer NOT NULL,
	`median_cents` integer NOT NULL,
	`upper_cents` integer NOT NULL,
	`confidence` text,
	`confidence_score` integer,
	`valuability` text,
	`source` text NOT NULL,
	`trigger` text NOT NULL,
	`request_id` text,
	`applied_at` text,
	`previous_value_cents` integer,
	FOREIGN KEY (`property_id`) REFERENCES `properties`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "property_valuation_history_lower_positive" CHECK("property_valuation_history"."lower_cents" > 0),
	CONSTRAINT "property_valuation_history_bounds_order" CHECK("property_valuation_history"."lower_cents" <= "property_valuation_history"."median_cents" AND "property_valuation_history"."median_cents" <= "property_valuation_history"."upper_cents"),
	CONSTRAINT "property_valuation_history_confidence_score_range" CHECK("property_valuation_history"."confidence_score" IS NULL OR ("property_valuation_history"."confidence_score" >= 0 AND "property_valuation_history"."confidence_score" <= 100))
);
--> statement-breakpoint
CREATE INDEX `property_valuation_history_property_valued_idx` ON `property_valuation_history` (`property_id`,`valued_at`);--> statement-breakpoint
CREATE TABLE `valuation_provider_quota` (
	`provider` text PRIMARY KEY NOT NULL,
	`limit_count` integer NOT NULL,
	`used_count` integer NOT NULL,
	`remaining_count` integer NOT NULL,
	`reset_at` text,
	`tariff` text,
	`observed_at` text NOT NULL,
	CONSTRAINT "valuation_provider_quota_limit_non_negative" CHECK("valuation_provider_quota"."limit_count" >= 0),
	CONSTRAINT "valuation_provider_quota_used_non_negative" CHECK("valuation_provider_quota"."used_count" >= 0),
	CONSTRAINT "valuation_provider_quota_remaining_non_negative" CHECK("valuation_provider_quota"."remaining_count" >= 0)
);
--> statement-breakpoint
ALTER TABLE `properties` ADD `property_type` text;--> statement-breakpoint
ALTER TABLE `properties` ADD `auto_valuation_interval` text DEFAULT 'off' NOT NULL;--> statement-breakpoint
ALTER TABLE `properties` ADD `last_auto_valuation_at` text;--> statement-breakpoint
ALTER TABLE `properties` ADD `last_auto_valuation_attempt_at` text;--> statement-breakpoint
ALTER TABLE `properties` ADD `last_auto_valuation_outcome` text;--> statement-breakpoint
ALTER TABLE `properties` ADD `estimated_value_source` text DEFAULT 'manual' NOT NULL;