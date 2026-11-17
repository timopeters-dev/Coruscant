import { describe, expect, it } from "vitest";
import {
  allocationSettingsSchema,
  finanzCockpitSummarySchema,
  householdSummarySchema,
} from "./external";

describe("finanzCockpitSummarySchema", () => {
  it("accepts valid payload including 0-cent assets and negative personal net worth", () => {
    const parsed = finanzCockpitSummarySchema.safeParse({
      source: "finanz_cockpit",
      liquidCashCents: 0,
      etfStocksCents: 0,
      cryptoCents: 0,
      totalPersonalNetWorthCents: -50_000,
      fetchedAt: "2026-11-16T12:00:00.000Z",
    });

    expect(parsed.success).toBe(true);
  });

  it("rejects float cent amounts, negative asset fields, wrong source, and invalid datetime", () => {
    expect(
      finanzCockpitSummarySchema.safeParse({
        source: "finanz_cockpit",
        liquidCashCents: 123.45,
        etfStocksCents: 0,
        cryptoCents: 0,
        totalPersonalNetWorthCents: 123,
        fetchedAt: "2026-11-16T12:00:00.000Z",
      }).success,
    ).toBe(false);

    expect(
      finanzCockpitSummarySchema.safeParse({
        source: "finanz_cockpit",
        liquidCashCents: -1,
        etfStocksCents: 0,
        cryptoCents: 0,
        totalPersonalNetWorthCents: 0,
        fetchedAt: "2026-11-16T12:00:00.000Z",
      }).success,
    ).toBe(false);

    expect(
      finanzCockpitSummarySchema.safeParse({
        source: "other_app",
        liquidCashCents: 100,
        etfStocksCents: 0,
        cryptoCents: 0,
        totalPersonalNetWorthCents: 100,
        fetchedAt: "2026-11-16T12:00:00.000Z",
      }).success,
    ).toBe(false);

    expect(
      finanzCockpitSummarySchema.safeParse({
        source: "finanz_cockpit",
        liquidCashCents: 100,
        etfStocksCents: 0,
        cryptoCents: 0,
        totalPersonalNetWorthCents: 100,
        fetchedAt: "16.11.2026",
      }).success,
    ).toBe(false);
  });

  it("accepts optional household payload including 0-cent fields and negative balanceCents", () => {
    const parsed = finanzCockpitSummarySchema.safeParse({
      source: "finanz_cockpit",
      liquidCashCents: 200_000,
      etfStocksCents: 500_000,
      cryptoCents: 0,
      totalPersonalNetWorthCents: 700_000,
      fetchedAt: "2026-11-17T12:00:00.000Z",
      household: {
        balanceCents: -15_000,
        recurringInflowCents: 460_000,
        recurringOutflowCents: 195_000,
        variableBudgetsCents: 0,
        variableRollingAvg3MCents: 98_500,
        variableRollingAvg6MCents: 94_000,
        categoriesBreakdown: [
          {
            categoryId: "cat-food",
            categoryName: "Lebensmittel",
            color: "#059669",
            budgetCents: 60_000,
            avg3MCents: 62_000,
            avg6MCents: 59_000,
          },
        ],
      },
    });

    expect(parsed.success).toBe(true);
  });

  it("rejects invalid household payloads (floats, negative averages, missing breakdown fields)", () => {
    expect(
      householdSummarySchema.safeParse({
        balanceCents: 100.5,
        recurringInflowCents: 0,
        recurringOutflowCents: 0,
        variableBudgetsCents: 0,
        variableRollingAvg3MCents: 0,
        variableRollingAvg6MCents: 0,
        categoriesBreakdown: [],
      }).success,
    ).toBe(false);

    expect(
      householdSummarySchema.safeParse({
        balanceCents: 100,
        recurringInflowCents: 0,
        recurringOutflowCents: 0,
        variableBudgetsCents: 0,
        variableRollingAvg3MCents: -1,
        variableRollingAvg6MCents: 0,
        categoriesBreakdown: [],
      }).success,
    ).toBe(false);

    expect(
      householdSummarySchema.safeParse({
        balanceCents: 100,
        recurringInflowCents: 0,
        recurringOutflowCents: 0,
        variableBudgetsCents: 0,
        variableRollingAvg3MCents: 0,
        variableRollingAvg6MCents: 0,
        categoriesBreakdown: [{ categoryId: "c1" }],
      }).success,
    ).toBe(false);
  });

  it("validates allocationSettingsSchema", () => {
    expect(
      allocationSettingsSchema.safeParse({
        mode: "mode_b",
        variableBasis: "avg_3m",
        includeContractsInModeB: false,
      }).success,
    ).toBe(true);

    expect(
      allocationSettingsSchema.safeParse({
        mode: "mode_c",
        variableBasis: "avg_3m",
        includeContractsInModeB: false,
      }).success,
    ).toBe(false);
  });
});
