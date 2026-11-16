import { describe, expect, it } from "vitest";
import { finanzCockpitSummarySchema } from "./external";

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
});
