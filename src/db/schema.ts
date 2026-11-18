import { sql } from "drizzle-orm";
import {
  type AnySQLiteColumn,
  check,
  index,
  integer,
  uniqueIndex,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";

export const appMeta = sqliteTable("app_meta", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const properties = sqliteTable(
  "properties",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    usage: text("usage", { enum: ["owner_occupied", "rented"] })
      .notNull()
      .default("owner_occupied"),
    purchaseDate: text("purchase_date"),
    purchasePriceCents: integer("purchase_price_cents"),
    estimatedValueCents: integer("estimated_value_cents").notNull().default(0),
    estimatedValueAsOf: text("estimated_value_as_of"),
    maintenanceReservePotId: text("maintenance_reserve_pot_id").references(
      (): AnySQLiteColumn => pots.id,
      { onDelete: "set null" },
    ),
    monthlyColdRentCents: integer("monthly_cold_rent_cents"),
    monthlyNonRecoverableCostsCents: integer(
      "monthly_non_recoverable_costs_cents",
    ),
    monthlyMaintenanceAllowanceCents: integer(
      "monthly_maintenance_allowance_cents",
    ),
    depreciationBasisCents: integer("depreciation_basis_cents"),
    street: text("street"),
    houseNumber: text("house_number"),
    postalCode: text("postal_code"),
    city: text("city"),
    livingAreaSqm: integer("living_area_sqm"),
    usableAreaSqm: integer("usable_area_sqm"),
    plotAreaSqm: integer("plot_area_sqm"),
    constructionYear: integer("construction_year"),
    energyClass: text("energy_class", {
      enum: ["A+", "A", "B", "C", "D", "E", "F", "G", "H"],
    }),
    renovations: text("renovations"),
    features: text("features"),
    imagePath: text("image_path"),
    propertyType: text("property_type", {
      enum: [
        "etw",
        "efh",
        "dhh",
        "rh",
        "reh",
        "mfh",
        "bungalow",
        "villa",
        "sonstiges",
      ],
    }),
    autoValuationInterval: text("auto_valuation_interval", {
      enum: ["off", "weekly", "biweekly", "monthly", "quarterly"],
    })
      .notNull()
      .default("off"),
    lastAutoValuationAt: text("last_auto_valuation_at"),
    lastAutoValuationAttemptAt: text("last_auto_valuation_attempt_at"),
    lastAutoValuationOutcome: text("last_auto_valuation_outcome", {
      enum: ["written", "history_only", "not_valuable", "rejected", "error"],
    }),
    estimatedValueSource: text("estimated_value_source", {
      enum: ["manual", "immoanalyse"],
    })
      .notNull()
      .default("manual"),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    check(
      "properties_estimated_value_non_negative",
      sql`${table.estimatedValueCents} >= 0`,
    ),
    check(
      "properties_purchase_price_non_negative",
      sql`${table.purchasePriceCents} IS NULL OR ${table.purchasePriceCents} >= 0`,
    ),
    check(
      "properties_living_area_positive",
      sql`${table.livingAreaSqm} IS NULL OR ${table.livingAreaSqm} > 0`,
    ),
    check(
      "properties_usable_area_positive",
      sql`${table.usableAreaSqm} IS NULL OR ${table.usableAreaSqm} > 0`,
    ),
    check(
      "properties_plot_area_positive",
      sql`${table.plotAreaSqm} IS NULL OR ${table.plotAreaSqm} > 0`,
    ),
    check(
      "properties_construction_year_range",
      sql`${table.constructionYear} IS NULL OR (${table.constructionYear} >= 1500 AND ${table.constructionYear} <= 2100)`,
    ),
  ],
);

export const financialContracts = sqliteTable(
  "financial_contracts",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    provider: text("provider"),
    sphere: text("sphere", { enum: ["household", "personal"] })
      .notNull()
      .default("household"),
    category: text("category", { enum: ["loan", "savings_contract"] }).notNull(),
    status: text("status", { enum: ["active", "paused", "closed"] })
      .notNull()
      .default("active"),
    currentBalanceCents: integer("current_balance_cents").notNull(),
    balanceAsOfDate: text("balance_as_of_date").notNull(),
    monthlyRateCents: integer("monthly_rate_cents").notNull().default(0),
    interestRateBps: integer("interest_rate_bps").notNull().default(0),
    linkedPropertyId: text("linked_property_id").references(
      () => properties.id,
      { onDelete: "set null" },
    ),
    milestoneDate: text("milestone_date"),
    milestoneLabel: text("milestone_label"),
    repaymentType: text("repayment_type", {
      enum: ["annuity", "installment", "lump_sum"],
    }),
    specialRepaymentMaxYearlyCents: integer(
      "special_repayment_max_yearly_cents",
    ),
    fixedInterestUntil: text("fixed_interest_until"),
    targetSumCents: integer("target_sum_cents"),
    allocationThresholdPercent: integer("allocation_threshold_percent"),
    futureLoanInterestRateBps: integer("future_loan_interest_rate_bps"),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    check(
      "financial_contracts_balance_non_negative",
      sql`${table.currentBalanceCents} >= 0`,
    ),
    check(
      "financial_contracts_monthly_rate_non_negative",
      sql`${table.monthlyRateCents} >= 0`,
    ),
    check(
      "financial_contracts_interest_rate_non_negative",
      sql`${table.interestRateBps} >= 0`,
    ),
    check(
      "financial_contracts_allocation_threshold_range",
      sql`${table.allocationThresholdPercent} IS NULL OR (${table.allocationThresholdPercent} >= 0 AND ${table.allocationThresholdPercent} <= 100)`,
    ),
  ],
);

export const cashflowItems = sqliteTable(
  "cashflow_items",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    direction: text("direction", { enum: ["inflow", "outflow"] }).notNull(),
    amountCents: integer("amount_cents").notNull(),
    frequency: text("frequency", {
      enum: ["monthly", "quarterly", "yearly"],
    }).notNull(),
    source: text("source", {
      enum: ["manual", "finanz_cockpit_sync", "contract_linked", "property_linked"],
    })
      .notNull()
      .default("manual"),
    linkedContractId: text("linked_contract_id").references(
      () => financialContracts.id,
      { onDelete: "cascade" },
    ),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    check("cashflow_items_amount_non_negative", sql`${table.amountCents} >= 0`),
  ],
);

export const pots = sqliteTable(
  "pots",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    priority: integer("priority").notNull(),
    currentCents: integer("current_cents").notNull().default(0),
    targetCents: integer("target_cents"),
    /** Optionaler Zieltermin (YYYY-MM-DD); nur zusammen mit targetCents (zod). */
    targetDate: text("target_date"),
    ruleType: text("rule_type", {
      enum: ["fill_to_target", "fixed_monthly", "percentage_of_remainder"],
    }).notNull(),
    fixedMonthlyCents: integer("fixed_monthly_cents"),
    remainderPercentage: integer("remainder_percentage"),
    linkedContractId: text("linked_contract_id").references(
      () => financialContracts.id,
      { onDelete: "set null" },
    ),
    linkedPropertyId: text("linked_property_id").references(
      (): AnySQLiteColumn => properties.id,
      { onDelete: "set null" },
    ),
    externalLinkKind: text("external_link_kind", {
      enum: ["account", "position"],
    }),
    externalLinkRef: text("external_link_ref"),
    externalLinkScope: text("external_link_scope", {
      enum: ["personal", "household"],
    }),
    /** Zweck des Topfs für den Investment-Coach; NULL = nicht festgelegt. */
    purpose: text("purpose", {
      enum: ["emergency_fund", "goal", "investment"],
    }),
    /** Age of the calibrated stand in finanz_cockpit (balanceAsOf, fallback fetchedAt). */
    externalSyncedAt: text("external_synced_at"),
    /** When the link was last set/changed (local time); starts the pending-transfer window. */
    externalLinkedAt: text("external_linked_at"),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    check(
      "pots_external_link_pair",
      sql`(${table.externalLinkKind} IS NULL AND ${table.externalLinkRef} IS NULL) OR (${table.externalLinkKind} IS NOT NULL AND ${table.externalLinkRef} IS NOT NULL)`,
    ),
    uniqueIndex("pots_external_link_unique").on(
      table.externalLinkKind,
      table.externalLinkRef,
    ),
    check("pots_current_non_negative", sql`${table.currentCents} >= 0`),
    check(
      "pots_target_non_negative",
      sql`${table.targetCents} IS NULL OR ${table.targetCents} >= 0`,
    ),
    check(
      "pots_fixed_monthly_non_negative",
      sql`${table.fixedMonthlyCents} IS NULL OR ${table.fixedMonthlyCents} >= 0`,
    ),
    check(
      "pots_remainder_percentage_range",
      sql`${table.remainderPercentage} IS NULL OR (${table.remainderPercentage} >= 0 AND ${table.remainderPercentage} <= 100)`,
    ),
  ],
);

export const potAllocations = sqliteTable(
  "pot_allocations",
  {
    id: text("id").primaryKey(),
    potId: text("pot_id")
      .notNull()
      .references(() => pots.id, { onDelete: "cascade" }),
    amountCents: integer("amount_cents").notNull(),
    sourceLabel: text("source_label").notNull(),
    allocatedAt: text("allocated_at").notNull(),
  },
  (table) => [
    check(
      "pot_allocations_amount_non_negative",
      sql`${table.amountCents} >= 0`,
    ),
  ],
);

export const documents = sqliteTable(
  "documents",
  {
    id: text("id").primaryKey(),
    filename: text("filename").notNull(),
    storagePath: text("storage_path").notNull(),
    sha256Hash: text("sha256_hash").notNull().unique(),
    status: text("status", { enum: ["pending_review", "verified"] })
      .notNull()
      .default("pending_review"),
    documentType: text("document_type", {
      enum: [
        "invoice",
        "bauspar_statement",
        "loan_statement",
        "contract",
        "tax_notice",
        "other",
      ],
    })
      .notNull()
      .default("other"),
    documentDate: text("document_date"),
    issuer: text("issuer"),
    totalAmountCents: integer("total_amount_cents"),
    linkedPropertyId: text("linked_property_id").references(
      () => properties.id,
      { onDelete: "set null" },
    ),
    linkedContractId: text("linked_contract_id").references(
      () => financialContracts.id,
      { onDelete: "set null" },
    ),
    isTaxRelevant: integer("is_tax_relevant", { mode: "boolean" })
      .notNull()
      .default(false),
    taxYear: integer("tax_year"),
    taxCategory: text("tax_category", {
      enum: [
        "handwerker_35a",
        "haushaltsnahe_dl_35a",
        "werbungskosten_vv",
        "capital_gains",
        "other",
      ],
    }),
    deductibleAmountCents: integer("deductible_amount_cents"),
    detectedBalanceCents: integer("detected_balance_cents"),
    extractedContractJson: text("extracted_contract_json"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    check(
      "documents_total_amount_non_negative",
      sql`${table.totalAmountCents} IS NULL OR ${table.totalAmountCents} >= 0`,
    ),
    check(
      "documents_deductible_amount_non_negative",
      sql`${table.deductibleAmountCents} IS NULL OR ${table.deductibleAmountCents} >= 0`,
    ),
    check(
      "documents_detected_balance_non_negative",
      sql`${table.detectedBalanceCents} IS NULL OR ${table.detectedBalanceCents} >= 0`,
    ),
  ],
);

export const externalSnapshots = sqliteTable(
  "external_snapshots",
  {
    id: text("id").primaryKey(),
    source: text("source", { enum: ["finanz_cockpit"] })
      .notNull()
      .default("finanz_cockpit"),
    liquidCashCents: integer("liquid_cash_cents").notNull(),
    etfStocksCents: integer("etf_stocks_cents").notNull(),
    cryptoCents: integer("crypto_cents").notNull(),
    totalPersonalNetWorthCents: integer(
      "total_personal_net_worth_cents",
    ).notNull(),
    householdJson: text("household_json"),
    accountsJson: text("accounts_json"),
    positionsJson: text("positions_json"),
    fetchedAt: text("fetched_at").notNull(),
  },
  (table) => [
    check(
      "external_snapshots_liquid_cash_non_negative",
      sql`${table.liquidCashCents} >= 0`,
    ),
    check(
      "external_snapshots_etf_stocks_non_negative",
      sql`${table.etfStocksCents} >= 0`,
    ),
    check(
      "external_snapshots_crypto_non_negative",
      sql`${table.cryptoCents} >= 0`,
    ),
  ],
);

export const propertyValuationHistory = sqliteTable(
  "property_valuation_history",
  {
    id: text("id").primaryKey(),
    propertyId: text("property_id")
      .notNull()
      .references(() => properties.id, { onDelete: "cascade" }),
    valuedAt: text("valued_at").notNull(),
    dataAsOf: text("data_as_of"),
    lowerCents: integer("lower_cents").notNull(),
    medianCents: integer("median_cents").notNull(),
    upperCents: integer("upper_cents").notNull(),
    confidence: text("confidence", { enum: ["low", "medium", "high"] }),
    confidenceScore: integer("confidence_score"),
    valuability: text("valuability", {
      enum: ["valuable", "valuable_with_limitations"],
    }),
    source: text("source", { enum: ["manual", "immoanalyse"] }).notNull(),
    trigger: text("trigger", { enum: ["auto", "manual"] }).notNull(),
    requestId: text("request_id"),
    appliedAt: text("applied_at"),
    previousValueCents: integer("previous_value_cents"),
  },
  (table) => [
    index("property_valuation_history_property_valued_idx").on(
      table.propertyId,
      table.valuedAt,
    ),
    check(
      "property_valuation_history_lower_positive",
      sql`${table.lowerCents} > 0`,
    ),
    check(
      "property_valuation_history_bounds_order",
      sql`${table.lowerCents} <= ${table.medianCents} AND ${table.medianCents} <= ${table.upperCents}`,
    ),
    check(
      "property_valuation_history_confidence_score_range",
      sql`${table.confidenceScore} IS NULL OR (${table.confidenceScore} >= 0 AND ${table.confidenceScore} <= 100)`,
    ),
  ],
);

export const valuationProviderQuota = sqliteTable(
  "valuation_provider_quota",
  {
    provider: text("provider", { enum: ["immoanalyse"] }).primaryKey(),
    limitCount: integer("limit_count").notNull(),
    usedCount: integer("used_count").notNull(),
    remainingCount: integer("remaining_count").notNull(),
    resetAt: text("reset_at"),
    tariff: text("tariff"),
    observedAt: text("observed_at").notNull(),
  },
  (table) => [
    check("valuation_provider_quota_limit_non_negative", sql`${table.limitCount} >= 0`),
    check("valuation_provider_quota_used_non_negative", sql`${table.usedCount} >= 0`),
    check(
      "valuation_provider_quota_remaining_non_negative",
      sql`${table.remainingCount} >= 0`,
    ),
  ],
);

export type AppMetaRow = typeof appMeta.$inferSelect;
export type NewAppMetaRow = typeof appMeta.$inferInsert;

export type PropertyRow = typeof properties.$inferSelect;
export type NewPropertyRow = typeof properties.$inferInsert;

export type FinancialContractRow = typeof financialContracts.$inferSelect;
export type NewFinancialContractRow = typeof financialContracts.$inferInsert;

export type CashflowItemRow = typeof cashflowItems.$inferSelect;
export type NewCashflowItemRow = typeof cashflowItems.$inferInsert;

export type PotRow = typeof pots.$inferSelect;
export type NewPotRow = typeof pots.$inferInsert;

export type PotAllocationRow = typeof potAllocations.$inferSelect;
export type NewPotAllocationRow = typeof potAllocations.$inferInsert;

export type DocumentRow = typeof documents.$inferSelect;
export type NewDocumentRow = typeof documents.$inferInsert;

export type ExternalSnapshotRow = typeof externalSnapshots.$inferSelect;
export type NewExternalSnapshotRow = typeof externalSnapshots.$inferInsert;

export type PropertyValuationHistoryRow =
  typeof propertyValuationHistory.$inferSelect;
export type NewPropertyValuationHistoryRow =
  typeof propertyValuationHistory.$inferInsert;

export type ValuationProviderQuotaRow =
  typeof valuationProviderQuota.$inferSelect;
export type NewValuationProviderQuotaRow =
  typeof valuationProviderQuota.$inferInsert;
