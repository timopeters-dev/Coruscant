import { describe, expect, it } from "vitest";
import {
  calculateBalanceBarBreakdown,
  calculateHouseholdBalance,
} from "./balance";
import type { DomainContract } from "./contracts";
import type { DomainPot } from "./waterfall";

describe("calculateHouseholdBalance", () => {
  const pots: DomainPot[] = [
    {
      id: "pot-1",
      name: "Instandhaltung Musterstraße 1",
      priority: 1,
      currentCents: 1_000_000,
      targetCents: 2_000_000,
      ruleType: "fill_to_target",
    },
    {
      id: "pot-2",
      name: "Urlaub",
      priority: 2,
      currentCents: 250_000,
      targetCents: null,
      ruleType: "percentage_of_remainder",
      remainderPercentage: 100,
    },
  ];

  const contracts: DomainContract[] = [
    {
      id: "loan-1",
      name: "Hauskredit Musterbank",
      sphere: "household",
      category: "loan",
      status: "active",
      currentBalanceCents: 20_000_000,
      balanceAsOfDate: "2026-01-01",
      monthlyRateCents: 100_000,
      interestRateBps: 0,
      repaymentType: "installment",
    },
    {
      id: "sav-1",
      name: "Bausparvertrag Musterkasse",
      sphere: "household",
      category: "savings_contract",
      status: "active",
      currentBalanceCents: 3_000_000,
      balanceAsOfDate: "2026-01-01",
      monthlyRateCents: 50_000,
      interestRateBps: 0,
    },
    {
      id: "closed-loan",
      name: "Abgelöster Kredit",
      sphere: "household",
      category: "loan",
      status: "closed",
      currentBalanceCents: 9_999_999,
      balanceAsOfDate: "2026-01-01",
      monthlyRateCents: 0,
      interestRateBps: 0,
    },
  ];

  it("calculates consolidated balance with property, projected contracts, pots, and external snapshot", () => {
    const balance = calculateHouseholdBalance({
      asOfDate: "2026-03-01", // 2 months elapsed
      properties: [
        {
          id: "prop-0",
          name: "Immobilie #0 (Musterstraße 1)",
          estimatedValueCents: 35_000_000,
        },
      ],
      contracts,
      pots,
      externalSnapshot: {
        liquidCashCents: 500_000,
        etfStocksCents: 2_000_000,
        cryptoCents: 100_000,
        totalPersonalNetWorthCents: 2_600_000,
        fetchedAt: "2026-03-01T10:00:00.000Z",
      },
    });

    expect(balance.householdLiquidCents).toBe(1_250_000);
    expect(balance.personalExternalAssetsCents).toBe(2_600_000);
    expect(balance.freeAssetsCents).toBe(3_850_000);
    expect(balance.propertiesValueCents).toBe(35_000_000);
    // sav-1: 3_000_000 + 2 * 50_000 = 3_100_000
    expect(balance.savingsContractsValueCents).toBe(3_100_000);
    expect(balance.boundAssetsCents).toBe(38_100_000);
    expect(balance.totalAssetsCents).toBe(41_950_000);
    // loan-1: 20_000_000 - 2 * 100_000 = 19_800_000 (closed-loan ignored)
    expect(balance.liabilitiesCents).toBe(19_800_000);
    expect(balance.netWorthCents).toBe(22_150_000);
    expect(balance.householdNetWorthCents).toBe(19_550_000);
  });

  it("sets personalExternalAssetsCents to 0 when externalSnapshot is null", () => {
    const balance = calculateHouseholdBalance({
      asOfDate: "2026-01-01",
      properties: [],
      contracts: [],
      pots,
      externalSnapshot: null,
    });

    expect(balance.personalExternalAssetsCents).toBe(0);
    expect(balance.householdNetWorthCents).toBe(balance.netWorthCents);
    expect(balance.netWorthCents).toBe(1_250_000);
  });

  it("excludes personal-sphere contracts from householdNetWorthCents while consolidating them into netWorthCents", () => {
    const personalLoan: DomainContract = {
      id: "personal-loan",
      name: "Persönlicher Kredit Musterbank",
      sphere: "personal",
      category: "loan",
      status: "active",
      currentBalanceCents: 500_000,
      balanceAsOfDate: "2026-01-01",
      monthlyRateCents: 0,
      interestRateBps: 0,
      repaymentType: "lump_sum",
    };
    const personalSavings: DomainContract = {
      id: "personal-sav",
      name: "Persönlicher Sparvertrag",
      sphere: "personal",
      category: "savings_contract",
      status: "active",
      currentBalanceCents: 200_000,
      balanceAsOfDate: "2026-01-01",
      monthlyRateCents: 0,
      interestRateBps: 0,
    };

    const balance = calculateHouseholdBalance({
      asOfDate: "2026-01-01",
      properties: [],
      contracts: [contracts[0]!, personalLoan, personalSavings],
      pots,
    });

    expect(balance.householdLiabilitiesCents).toBe(20_000_000);
    expect(balance.personalLiabilitiesCents).toBe(500_000);
    expect(balance.liabilitiesCents).toBe(20_500_000);
    expect(balance.personalContractsAssetsCents).toBe(200_000);
    expect(balance.savingsContractsValueCents).toBe(0);
    // Household net worth: 1_250_000 - 20_000_000 = -18_750_000 (personal contracts excluded)
    expect(balance.householdNetWorthCents).toBe(-18_750_000);
    // Consolidated net worth: (1_250_000 + 200_000) - 20_500_000 = -19_050_000
    expect(balance.netWorthCents).toBe(-19_050_000);
  });

  it("handles 0-cent totals and negative net worth (over-indebtedness)", () => {
    const zeroBalance = calculateHouseholdBalance({
      asOfDate: "2026-01-01",
      properties: [],
      contracts: [],
      pots: [],
    });
    expect(zeroBalance.netWorthCents).toBe(0);

    const negativeNetWorth = calculateHouseholdBalance({
      asOfDate: "2026-01-01",
      properties: [],
      contracts: [contracts[0]!],
      pots: [],
    });
    expect(negativeNetWorth.netWorthCents).toBe(-20_000_000);
  });

  it("rejects invalid asOfDate or negative values", () => {
    expect(() =>
      calculateHouseholdBalance({
        asOfDate: "2026-02-29",
        properties: [],
        contracts: [],
        pots: [],
      }),
    ).toThrow(RangeError);

    expect(() =>
      calculateHouseholdBalance({
        asOfDate: "2026-01-01",
        properties: [
          { id: "p", name: "Bad", estimatedValueCents: -100 },
        ],
        contracts: [],
        pots: [],
      }),
    ).toThrow(RangeError);
  });

  it("accounts for external overdraft when totalPersonalNetWorthCents < clamped external assets", () => {
    const withOverdraft = calculateHouseholdBalance({
      asOfDate: "2026-11-16",
      properties: [],
      contracts: [],
      pots: [
        {
          id: "pot-1",
          name: "Rücklage",
          priority: 1,
          currentCents: 100_000,
          targetCents: null,
          ruleType: "fill_to_target",
        },
      ],
      externalSnapshot: {
        liquidCashCents: 0,
        etfStocksCents: 2_000_000,
        cryptoCents: 0,
        totalPersonalNetWorthCents: 1_950_000,
        fetchedAt: "2026-11-16T10:00:00.000Z",
      },
    });

    expect(withOverdraft.personalExternalAssetsCents).toBe(2_000_000);
    expect(withOverdraft.personalLiabilitiesCents).toBe(50_000);
    expect(withOverdraft.liabilitiesCents).toBe(50_000);
    expect(withOverdraft.totalAssetsCents).toBe(2_100_000);
    expect(withOverdraft.netWorthCents).toBe(2_050_000);

    const negativeExternalNetWorth = calculateHouseholdBalance({
      asOfDate: "2026-11-16",
      properties: [],
      contracts: [],
      pots: [],
      externalSnapshot: {
        liquidCashCents: 0,
        etfStocksCents: 0,
        cryptoCents: 0,
        totalPersonalNetWorthCents: -75_000,
        fetchedAt: "2026-11-16T10:00:00.000Z",
      },
    });

    expect(negativeExternalNetWorth.personalExternalAssetsCents).toBe(0);
    expect(negativeExternalNetWorth.personalLiabilitiesCents).toBe(75_000);
    expect(negativeExternalNetWorth.liabilitiesCents).toBe(75_000);
    expect(negativeExternalNetWorth.netWorthCents).toBe(-75_000);
  });
});

describe("calculateBalanceBarBreakdown", () => {
  it("computes basis-point shares summing to exactly 10,000 bps", () => {
    const breakdown = calculateBalanceBarBreakdown({
      freeAssetsCents: 2_500_000,
      boundAssetsCents: 5_000_000,
      liabilitiesCents: 2_500_000,
    });

    expect(breakdown.hasData).toBe(true);
    expect(breakdown.totalVolumeCents).toBe(10_000_000);
    expect(breakdown.freeShareBps).toBe(2_500);
    expect(breakdown.boundShareBps).toBe(5_000);
    expect(breakdown.liabilitiesShareBps).toBe(2_500);
    expect(
      breakdown.freeShareBps +
        breakdown.boundShareBps +
        breakdown.liabilitiesShareBps,
    ).toBe(10_000);
  });

  it("handles zero total volume gracefully", () => {
    const breakdown = calculateBalanceBarBreakdown({
      freeAssetsCents: 0,
      boundAssetsCents: 0,
      liabilitiesCents: 0,
    });

    expect(breakdown.hasData).toBe(false);
    expect(breakdown.totalVolumeCents).toBe(0);
    expect(breakdown.freeShareBps).toBe(0);
    expect(breakdown.boundShareBps).toBe(0);
    expect(breakdown.liabilitiesShareBps).toBe(0);
  });

  it("normalizes 1/3 : 1/3 : 1/3 rounding remainder deterministically to 10,000 bps", () => {
    const breakdown = calculateBalanceBarBreakdown({
      freeAssetsCents: 100,
      boundAssetsCents: 100,
      liabilitiesCents: 100,
    });

    expect(breakdown.hasData).toBe(true);
    expect(breakdown.freeShareBps).toBe(3_334);
    expect(breakdown.boundShareBps).toBe(3_333);
    expect(breakdown.liabilitiesShareBps).toBe(3_333);
    expect(
      breakdown.freeShareBps +
        breakdown.boundShareBps +
        breakdown.liabilitiesShareBps,
    ).toBe(10_000);
  });

  it("handles liabilities-only volume as 10,000 bps liabilities", () => {
    const breakdown = calculateBalanceBarBreakdown({
      freeAssetsCents: 0,
      boundAssetsCents: 0,
      liabilitiesCents: 1_500_000,
    });

    expect(breakdown.hasData).toBe(true);
    expect(breakdown.freeShareBps).toBe(0);
    expect(breakdown.boundShareBps).toBe(0);
    expect(breakdown.liabilitiesShareBps).toBe(10_000);
  });

  it("throws RangeError on negative inputs", () => {
    expect(() =>
      calculateBalanceBarBreakdown({
        freeAssetsCents: -1,
        boundAssetsCents: 0,
        liabilitiesCents: 0,
      }),
    ).toThrow(RangeError);
  });
});
