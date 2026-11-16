PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_properties` (
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
	`street` text,
	`house_number` text,
	`postal_code` text,
	`city` text,
	`living_area_sqm` integer,
	`usable_area_sqm` integer,
	`plot_area_sqm` integer,
	`construction_year` integer,
	`energy_class` text,
	`features` text,
	`image_path` text,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`maintenance_reserve_pot_id`) REFERENCES `pots`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "properties_estimated_value_non_negative" CHECK("__new_properties"."estimated_value_cents" >= 0),
	CONSTRAINT "properties_purchase_price_non_negative" CHECK("__new_properties"."purchase_price_cents" IS NULL OR "__new_properties"."purchase_price_cents" >= 0),
	CONSTRAINT "properties_living_area_positive" CHECK("__new_properties"."living_area_sqm" IS NULL OR "__new_properties"."living_area_sqm" > 0),
	CONSTRAINT "properties_usable_area_positive" CHECK("__new_properties"."usable_area_sqm" IS NULL OR "__new_properties"."usable_area_sqm" > 0),
	CONSTRAINT "properties_plot_area_positive" CHECK("__new_properties"."plot_area_sqm" IS NULL OR "__new_properties"."plot_area_sqm" > 0),
	CONSTRAINT "properties_construction_year_range" CHECK("__new_properties"."construction_year" IS NULL OR ("__new_properties"."construction_year" >= 1500 AND "__new_properties"."construction_year" <= 2100))
);
--> statement-breakpoint
INSERT INTO `__new_properties`("id", "name", "usage", "purchase_date", "purchase_price_cents", "estimated_value_cents", "maintenance_reserve_pot_id", "monthly_cold_rent_cents", "monthly_non_recoverable_costs_cents", "depreciation_basis_cents", "street", "house_number", "postal_code", "city", "living_area_sqm", "usable_area_sqm", "plot_area_sqm", "construction_year", "energy_class", "features", "image_path", "updated_at") SELECT "id", "name", "usage", "purchase_date", "purchase_price_cents", "estimated_value_cents", "maintenance_reserve_pot_id", "monthly_cold_rent_cents", "monthly_non_recoverable_costs_cents", "depreciation_basis_cents", NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, "updated_at" FROM `properties`;--> statement-breakpoint
DROP TABLE `properties`;--> statement-breakpoint
ALTER TABLE `__new_properties` RENAME TO `properties`;--> statement-breakpoint
PRAGMA foreign_keys=ON;