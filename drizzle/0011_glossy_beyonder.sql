ALTER TABLE `properties` ADD `valuation_adjustments` text;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_property_valuation_history` (
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
	`adjustment_bps` integer DEFAULT 0 NOT NULL,
	`adjustments_json` text,
	`applied_choice` text,
	FOREIGN KEY (`property_id`) REFERENCES `properties`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "property_valuation_history_lower_positive" CHECK("__new_property_valuation_history"."lower_cents" > 0),
	CONSTRAINT "property_valuation_history_bounds_order" CHECK("__new_property_valuation_history"."lower_cents" <= "__new_property_valuation_history"."median_cents" AND "__new_property_valuation_history"."median_cents" <= "__new_property_valuation_history"."upper_cents"),
	CONSTRAINT "property_valuation_history_confidence_score_range" CHECK("__new_property_valuation_history"."confidence_score" IS NULL OR ("__new_property_valuation_history"."confidence_score" >= 0 AND "__new_property_valuation_history"."confidence_score" <= 100)),
	CONSTRAINT "property_valuation_history_adjustment_bps_range" CHECK("__new_property_valuation_history"."adjustment_bps" >= -5000 AND "__new_property_valuation_history"."adjustment_bps" <= 5000)
);
--> statement-breakpoint
INSERT INTO `__new_property_valuation_history`("id", "property_id", "valued_at", "data_as_of", "lower_cents", "median_cents", "upper_cents", "confidence", "confidence_score", "valuability", "source", "trigger", "request_id", "applied_at", "previous_value_cents", "adjustment_bps", "adjustments_json", "applied_choice") SELECT "id", "property_id", "valued_at", "data_as_of", "lower_cents", "median_cents", "upper_cents", "confidence", "confidence_score", "valuability", "source", "trigger", "request_id", "applied_at", "previous_value_cents", 0, NULL, NULL FROM `property_valuation_history`;--> statement-breakpoint
DROP TABLE `property_valuation_history`;--> statement-breakpoint
ALTER TABLE `__new_property_valuation_history` RENAME TO `property_valuation_history`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `property_valuation_history_property_valued_idx` ON `property_valuation_history` (`property_id`,`valued_at`);