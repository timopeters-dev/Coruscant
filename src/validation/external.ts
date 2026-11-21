import { z } from "zod";

const nonEmptyString = z.string().trim().min(1);
/** ISO datetime normalized to `toISOString()` (ms precision) so strings compare chronologically. */
const normalizedIsoDatetime = z.iso
  .datetime()
  .transform((value) => new Date(value).toISOString());

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

export const externalScopeSchema = z.enum(["personal", "household"]);

export const externalAccountSchema = z.object({
  id: nonEmptyString,
  name: nonEmptyString,
  type: z.enum(["checking", "savings", "brokerage", "paypal"]),
  scope: externalScopeSchema,
  balanceCents: signedSafeInt,
  /** When finanz_cockpit last updated the balance (not the response time). */
  balanceAsOf: normalizedIsoDatetime.nullable().optional(),
  holdingsValueCents: nonNegativeSafeInt,
});

export type ExternalAccount = z.infer<typeof externalAccountSchema>;

export const externalPositionSchema = z.object({
  id: nonEmptyString,
  accountId: nonEmptyString,
  symbol: nonEmptyString,
  isin: z.string().trim().min(1).nullable(),
  name: nonEmptyString,
  assetClass: z.enum(["etf", "stock", "crypto"]),
  marketValueCents: nonNegativeSafeInt,
  costBasisCents: nonNegativeSafeInt.nullable(),
  lastPriceAt: normalizedIsoDatetime.nullable(),
});

export type ExternalPosition = z.infer<typeof externalPositionSchema>;

export const finanzCockpitSummarySchema = z
  .object({
    source: z.literal("finanz_cockpit"),
    liquidCashCents: nonNegativeSafeInt,
    etfStocksCents: nonNegativeSafeInt,
    cryptoCents: nonNegativeSafeInt,
    totalPersonalNetWorthCents: signedSafeInt,
    fetchedAt: z.iso.datetime(),
    household: householdSummarySchema.optional(),
    accounts: z.array(externalAccountSchema).optional(),
    positions: z.array(externalPositionSchema).optional(),
  })
  .superRefine((data, ctx) => {
    const accountIds = new Set<string>();
    for (const [index, account] of (data.accounts ?? []).entries()) {
      if (accountIds.has(account.id)) {
        ctx.addIssue({
          code: "custom",
          path: ["accounts", index, "id"],
          message: "Doppelte Konto-ID.",
        });
      }
      accountIds.add(account.id);
    }

    const positionIds = new Set<string>();
    for (const [index, position] of (data.positions ?? []).entries()) {
      if (positionIds.has(position.id)) {
        ctx.addIssue({
          code: "custom",
          path: ["positions", index, "id"],
          message: "Doppelte Positions-ID.",
        });
      }
      positionIds.add(position.id);
      if (!accountIds.has(position.accountId)) {
        ctx.addIssue({
          code: "custom",
          path: ["positions", index, "accountId"],
          message: "Position verweist auf ein unbekanntes Konto.",
        });
      }
    }
  });

export type FinanzCockpitSummary = z.infer<typeof finanzCockpitSummarySchema>;

export const externalSyncRequestSchema = z.object({
  mode: z.enum(["manual", "auto"], { error: "Erlaubt sind nur 'manual' oder 'auto'." }).default("manual"),
});

export type ExternalSyncRequest = z.infer<typeof externalSyncRequestSchema>;

export const variableExpenseBasisSchema = z.enum(["budget", "avg_3m", "avg_6m"]);
export type VariableExpenseBasis = z.infer<typeof variableExpenseBasisSchema>;

export const allocationSettingsSchema = z.object({
  variableBasis: variableExpenseBasisSchema,
  includeContractItems: z.boolean(),
});

export type AllocationSettings = z.infer<typeof allocationSettingsSchema>;
