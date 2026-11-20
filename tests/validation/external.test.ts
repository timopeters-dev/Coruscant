import { describe, expect, it } from "vitest";
import {
  allocationSettingsSchema,
  finanzCockpitSummarySchema,
  householdSummarySchema,
} from "@/validation/external";

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
        variableBasis: "avg_3m",
        includeContractItems: false,
      }).success,
    ).toBe(true);

    expect(
      allocationSettingsSchema.safeParse({
        variableBasis: "avg_12m",
        includeContractItems: false,
      }).success,
    ).toBe(false);

    expect(
      allocationSettingsSchema.safeParse({
        variableBasis: "budget",
        includeContractItems: "true",
      }).success,
    ).toBe(false);
  });
});

describe("finanzCockpitSummarySchema accounts & positions", () => {
  const basePayload = {
    source: "finanz_cockpit" as const,
    liquidCashCents: 0,
    etfStocksCents: 0,
    cryptoCents: 0,
    totalPersonalNetWorthCents: 0,
    fetchedAt: "2026-11-17T12:00:00.000Z",
  };
  const account = {
    id: "acc-1",
    name: "Musterbank Tagesgeld",
    type: "savings" as const,
    scope: "household" as const,
    balanceCents: 100_000,
    holdingsValueCents: 0,
  };
  const position = {
    id: "pos-1",
    accountId: "acc-1",
    symbol: "MSTR",
    isin: "XX0000000001",
    name: "Muster-ETF",
    assetClass: "etf" as const,
    marketValueCents: 5_000,
    costBasisCents: null,
    lastPriceAt: null,
  };

  it("accepts payloads without accounts/positions (backward compatible) and valid ones", () => {
    expect(finanzCockpitSummarySchema.safeParse(basePayload).success).toBe(true);
    expect(
      finanzCockpitSummarySchema.safeParse({
        ...basePayload,
        accounts: [account, { ...account, id: "acc-2", balanceCents: -500 }],
        positions: [position],
      }).success,
    ).toBe(true);
    expect(
      finanzCockpitSummarySchema.safeParse({ ...basePayload, accounts: [], positions: [] }).success,
    ).toBe(true);
  });

  it("accepts balanceAsOf as ISO datetime, null or omitted and rejects other strings", () => {
    const ok = (extra: Record<string, unknown>) =>
      finanzCockpitSummarySchema.safeParse({ ...basePayload, accounts: [{ ...account, ...extra }] }).success;
    expect(ok({ balanceAsOf: "2026-11-17T06:00:00.000Z" })).toBe(true);
    expect(ok({ balanceAsOf: null })).toBe(true);
    expect(ok({})).toBe(true);
    expect(ok({ balanceAsOf: "gestern" })).toBe(false);
  });

  it("normalizes balanceAsOf and lastPriceAt to millisecond ISO strings", () => {
    const parsed = finanzCockpitSummarySchema.parse({
      ...basePayload,
      accounts: [{ ...account, balanceAsOf: "2026-11-17T06:00:00Z" }],
      positions: [{ ...position, lastPriceAt: "2026-11-17T06:00:00.5Z" }],
    });
    expect(parsed.accounts?.[0]?.balanceAsOf).toBe("2026-11-17T06:00:00.000Z");
    expect(parsed.positions?.[0]?.lastPriceAt).toBe("2026-11-17T06:00:00.500Z");
    expect(
      finanzCockpitSummarySchema.parse({ ...basePayload, accounts: [{ ...account, balanceAsOf: null }] }).accounts?.[0]?.balanceAsOf,
    ).toBeNull();
  });

  it.each([
    ["float balance", { accounts: [{ ...account, balanceCents: 1.5 }] }],
    ["negative holdings", { accounts: [{ ...account, holdingsValueCents: -1 }] }],
    ["unknown scope", { accounts: [{ ...account, scope: "other" }] }],
    ["duplicate account ids", { accounts: [account, account] }],
    ["negative market value", { accounts: [account], positions: [{ ...position, marketValueCents: -1 }] }],
    ["unknown assetClass", { accounts: [account], positions: [{ ...position, assetClass: "bond" }] }],
    ["duplicate position ids", { accounts: [account], positions: [position, position] }],
    ["position without account", { accounts: [account], positions: [{ ...position, accountId: "zzz" }] }],
    ["position without any accounts", { positions: [position] }],
    ["invalid lastPriceAt", { accounts: [account], positions: [{ ...position, lastPriceAt: "gestern" }] }],
  ])("rejects %s", (_label, extra) => {
    expect(finanzCockpitSummarySchema.safeParse({ ...basePayload, ...extra }).success).toBe(false);
  });
});
