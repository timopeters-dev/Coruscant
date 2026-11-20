import { describe, expect, expectTypeOf, it } from "vitest";
import {
  type BalanceSummary,
  calculateBalanceBarBreakdown,
  calculateHouseholdBalance,
} from "@/domain/cockpit/balance";
import type { DomainContract } from "@/domain/contracts/contract";
import type { DomainPot } from "@/domain/allocation/waterfall";

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
      category: "loan",
      status: "closed",
      currentBalanceCents: 9_999_999,
      balanceAsOfDate: "2026-01-01",
      monthlyRateCents: 0,
      interestRateBps: 0,
    },
  ];

  it("calculates the household balance from pots, property and projected contracts", () => {
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
    });

    expect(balance.freeAssetsCents).toBe(1_250_000);
    expect(balance.propertiesValueCents).toBe(35_000_000);
    // sav-1: 3_000_000 + 2 * 50_000 = 3_100_000
    expect(balance.savingsContractsValueCents).toBe(3_100_000);
    expect(balance.boundAssetsCents).toBe(38_100_000);
    expect(balance.totalAssetsCents).toBe(39_350_000);
    // loan-1: 20_000_000 - 2 * 100_000 = 19_800_000 (closed-loan ignored)
    expect(balance.liabilitiesCents).toBe(19_800_000);
    expect(balance.netWorthCents).toBe(19_550_000);
    expect(balance.conflictingLinkedPotsCents).toBe(0);
    expect(balance.outOfScopeLinkedPotsCents).toBe(0);
  });

  it("returns only household fields (no personal/household-prefixed keys)", () => {
    const balance = calculateHouseholdBalance({
      asOfDate: "2026-01-01",
      properties: [],
      contracts: [],
      pots: [],
    });
    expect(Object.keys(balance).filter((k) => /personal|household/i.test(k))).toEqual([]);
    expectTypeOf<Extract<keyof BalanceSummary, `personal${string}` | `household${string}`>>().toEqualTypeOf<never>();
  });

  it("returns all zeros without pots, contracts and properties", () => {
    const balance = calculateHouseholdBalance({
      asOfDate: "2026-01-01",
      properties: [],
      contracts: [],
      pots: [],
    });
    expect(balance).toEqual({
      asOfDate: "2026-01-01",
      freeAssetsCents: 0,
      conflictingLinkedPotsCents: 0,
      outOfScopeLinkedPotsCents: 0,
      propertiesValueCents: 0,
      savingsContractsValueCents: 0,
      boundAssetsCents: 0,
      totalAssetsCents: 0,
      liabilitiesCents: 0,
      netWorthCents: 0,
    });
  });

  it("counts a 0-cent pot and ignores closed contracts", () => {
    const balance = calculateHouseholdBalance({
      asOfDate: "2026-01-01",
      properties: [],
      contracts: [contracts[2]!],
      pots: [{ ...pots[0]!, currentCents: 0 }],
    });
    expect(balance.freeAssetsCents).toBe(0);
    expect(balance.liabilitiesCents).toBe(0);
  });

  it("rejects negative pot stands", () => {
    expect(() =>
      calculateHouseholdBalance({
        asOfDate: "2026-01-01",
        properties: [],
        contracts: [],
        pots: [{ ...pots[0]!, currentCents: -1 }],
      }),
    ).toThrow(RangeError);
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

  it("nets a negative Bausparvertrag (Abschlussgebühr) against other savings contracts", () => {
    const summary = calculateHouseholdBalance({
      asOfDate: "2026-01-01",
      properties: [],
      pots: [],
      contracts: [
        {
          id: "sav-pos",
          name: "Bausparvertrag Musterkasse",
          category: "savings_contract",
          status: "active",
          currentBalanceCents: 500_000,
          balanceAsOfDate: "2026-01-01",
          monthlyRateCents: 0,
          interestRateBps: 0,
        },
        {
          id: "sav-neg",
          name: "Bausparvertrag Muster neu",
          category: "savings_contract",
          status: "active",
          currentBalanceCents: -120_000,
          balanceAsOfDate: "2026-01-01",
          monthlyRateCents: 0,
          interestRateBps: 0,
        },
      ],
    });
    expect(summary.savingsContractsValueCents).toBe(380_000);
    expect(summary.liabilitiesCents).toBe(0);
    expect(summary.netWorthCents).toBe(380_000);
  });

  it("books an overall negative Bauspar balance as liability (assets stay >= 0)", () => {
    const summary = calculateHouseholdBalance({
      asOfDate: "2026-01-01",
      properties: [],
      pots: [],
      contracts: [
        {
          id: "sav-neg",
          name: "Bausparvertrag Muster neu",
          category: "savings_contract",
          status: "active",
          currentBalanceCents: -120_000,
          balanceAsOfDate: "2026-01-01",
          monthlyRateCents: 0,
          interestRateBps: 0,
        },
      ],
    });
    expect(summary.savingsContractsValueCents).toBe(0);
    expect(summary.boundAssetsCents).toBe(0);
    expect(summary.totalAssetsCents).toBe(0);
    expect(summary.liabilitiesCents).toBe(120_000);
    expect(summary.netWorthCents).toBe(-120_000);
    // Balkendiagramm akzeptiert die Werte (keine negativen Segmente).
    expect(() => calculateBalanceBarBreakdown(summary)).not.toThrow();
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

describe("calculateHouseholdBalance with excluded linked pots", () => {
  const base = { asOfDate: "2026-11-17", properties: [], contracts: [] };
  const mk = (
    id: string,
    currentCents: number,
    extra: Record<string, unknown> = {},
  ) => ({
    id,
    name: id,
    priority: 1,
    currentCents,
    targetCents: null,
    ruleType: "fixed_monthly" as const,
    ...extra,
  });

  it("excludes conflicting pots from freeAssetsCents and reports them separately", () => {
    const summary = calculateHouseholdBalance({
      ...base,
      pots: [
        mk("account", 500_000),
        mk("position", 400_000, { liquidityExclusion: "link_conflict" }),
        mk("virtual", 100_000, { liquidityExclusion: null }),
      ],
    });
    expect(summary.freeAssetsCents).toBe(600_000);
    expect(summary.conflictingLinkedPotsCents).toBe(400_000);
    expect(summary.outOfScopeLinkedPotsCents).toBe(0);
  });

  it("excludes out-of-scope pots and reports them separately", () => {
    const summary = calculateHouseholdBalance({
      ...base,
      pots: [
        mk("hh", 200_000),
        mk("oos", 300_000, { liquidityExclusion: "out_of_scope" }),
      ],
    });
    expect(summary.freeAssetsCents).toBe(200_000);
    expect(summary.outOfScopeLinkedPotsCents).toBe(300_000);
    expect(summary.totalAssetsCents).toBe(200_000);
  });

  it("sums conflicting and out-of-scope pots separately when both occur", () => {
    const summary = calculateHouseholdBalance({
      ...base,
      pots: [
        mk("a", 100, { liquidityExclusion: "link_conflict" }),
        mk("b", 20, { liquidityExclusion: "out_of_scope" }),
        mk("c", 3),
      ],
    });
    expect(summary.conflictingLinkedPotsCents).toBe(100);
    expect(summary.outOfScopeLinkedPotsCents).toBe(20);
    expect(summary.freeAssetsCents).toBe(3);
  });

  it("still validates currentCents of excluded pots", () => {
    expect(() =>
      calculateHouseholdBalance({
        ...base,
        pots: [mk("a", 1.5, { liquidityExclusion: "out_of_scope" })],
      }),
    ).toThrow(RangeError);
  });
});

describe("calculateHouseholdBalance with rented properties", () => {
  const baseDate = "2026-11-18";

  it("produces identical BalanceSummary regardless of usage (rented vs owner_occupied)", () => {
    const contracts = [
      {
        id: "loan-1",
        name: "Objektkredit Musterbank",
        category: "loan" as const,
        status: "active" as const,
        currentBalanceCents: 18_000_000,
        balanceAsOfDate: baseDate,
        monthlyRateCents: 60_000,
        interestRateBps: 350,
      },
    ];

    const ownerProp = {
      id: "prop-1",
      name: "Objekt Musterstraße 1",
      usage: "owner_occupied" as const,
      estimatedValueCents: 25_000_000,
    };
    const rentedProp = {
      id: "prop-1",
      name: "Objekt Musterstraße 1",
      usage: "rented" as const,
      estimatedValueCents: 25_000_000,
    };

    const asOwner = calculateHouseholdBalance({
      asOfDate: baseDate,
      properties: [ownerProp],
      contracts,
      pots: [],
    });

    const asRented = calculateHouseholdBalance({
      asOfDate: baseDate,
      properties: [rentedProp],
      contracts,
      pots: [],
    });

    expect(asRented).toEqual(asOwner);
  });

  it("counts rented property once in propertiesValueCents and household loan once in liabilitiesCents", () => {
    const rentedProp = {
      id: "prop-rent-1",
      name: "Wohnung Musterstraße 1",
      usage: "rented" as const,
      estimatedValueCents: 25_000_000,
    };
    const summary = calculateHouseholdBalance({
      asOfDate: baseDate,
      properties: [rentedProp],
      contracts: [
        {
          id: "loan-hh",
          name: "Haushaltskredit Musterbank",
          category: "loan",
          status: "active",
          currentBalanceCents: 15_000_000,
          balanceAsOfDate: baseDate,
          monthlyRateCents: 50_000,
          interestRateBps: 350,
        },
      ],
      pots: [],
    });

    expect(summary.propertiesValueCents).toBe(25_000_000);
    expect(summary.liabilitiesCents).toBe(15_000_000);
    expect(summary.netWorthCents).toBe(10_000_000);
  });

  it("sums Immobilie #0 and rented property in propertiesValueCents", () => {
    const prop0 = {
      id: "prop-0",
      name: "Immobilie #0",
      usage: "owner_occupied" as const,
      estimatedValueCents: 35_000_000,
    };
    const prop1 = {
      id: "prop-1",
      name: "Wohnung Musterstraße 1",
      usage: "rented" as const,
      estimatedValueCents: 25_000_000,
    };
    const summary = calculateHouseholdBalance({
      asOfDate: baseDate,
      properties: [prop0, prop1],
      contracts: [],
      pots: [],
    });

    expect(summary.propertiesValueCents).toBe(60_000_000);
  });
});
