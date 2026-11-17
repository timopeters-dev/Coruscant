import { z } from "zod";

const nonEmptyString = z.string().trim().min(1);
const nonNegativeSafeInt = z
  .number()
  .int()
  .nonnegative()
  .max(Number.MAX_SAFE_INTEGER);
const signedSafeInt = z
  .number()
  .int()
  .min(Number.MIN_SAFE_INTEGER)
  .max(Number.MAX_SAFE_INTEGER);

export const householdCategoryBreakdownSchema = z.object({
  categoryId: nonEmptyString,
  categoryName: nonEmptyString,
  color: nonEmptyString,
  budgetCents: nonNegativeSafeInt,
  avg3MCents: nonNegativeSafeInt,
  avg6MCents: nonNegativeSafeInt,
});

export type HouseholdCategoryBreakdownItem = z.infer<
  typeof householdCategoryBreakdownSchema
>;

export const householdSummarySchema = z.object({
  balanceCents: signedSafeInt,
  recurringInflowCents: nonNegativeSafeInt,
  recurringOutflowCents: nonNegativeSafeInt,
  variableBudgetsCents: nonNegativeSafeInt,
  variableRollingAvg3MCents: nonNegativeSafeInt,
  variableRollingAvg6MCents: nonNegativeSafeInt,
  categoriesBreakdown: z.array(householdCategoryBreakdownSchema),
});

export type HouseholdSummary = z.infer<typeof householdSummarySchema>;

export const finanzCockpitSummarySchema = z.object({
  source: z.literal("finanz_cockpit"),
  liquidCashCents: nonNegativeSafeInt,
  etfStocksCents: nonNegativeSafeInt,
  cryptoCents: nonNegativeSafeInt,
  totalPersonalNetWorthCents: signedSafeInt,
  fetchedAt: z.iso.datetime(),
  household: householdSummarySchema.optional(),
});

export type FinanzCockpitSummary = z.infer<typeof finanzCockpitSummarySchema>;

export const externalSyncRequestSchema = z.object({
  mode: z.enum(["manual", "auto"]).default("manual"),
});

export type ExternalSyncRequest = z.infer<typeof externalSyncRequestSchema>;

export const allocationModeSchema = z.enum(["mode_a", "mode_b"]);
export type AllocationMode = z.infer<typeof allocationModeSchema>;

export const variableExpenseBasisSchema = z.enum(["budget", "avg_3m", "avg_6m"]);
export type VariableExpenseBasis = z.infer<typeof variableExpenseBasisSchema>;

export const allocationSettingsSchema = z.object({
  mode: allocationModeSchema,
  variableBasis: variableExpenseBasisSchema,
  includeContractsInModeB: z.boolean(),
});

export type AllocationSettings = z.infer<typeof allocationSettingsSchema>;
