import { describe, expect, it } from "vitest";
import {
  calculateModeBCashflow,
  calculateMonthlyCashflow,
  deriveContractCashflowItems,
  type DomainCashflowItem,
  type ModeBHouseholdInput,
  normalizeItemToMonthlyCents,
} from "./cashflow";
import type { DomainContract } from "./contracts";

describe("normalizeItemToMonthlyCents", () => {
  it("normalizes monthly, quarterly, and yearly amounts with half-up rounding", () => {
    expect(normalizeItemToMonthlyCents(120_000, "monthly")).toBe(120_000);
    expect(normalizeItemToMonthlyCents(100, "quarterly")).toBe(33);
    expect(normalizeItemToMonthlyCents(200, "quarterly")).toBe(67);
    expect(normalizeItemToMonthlyCents(100, "yearly")).toBe(8);
    expect(normalizeItemToMonthlyCents(800, "yearly")).toBe(67);
    expect(normalizeItemToMonthlyCents(0, "yearly")).toBe(0);
  });

  it("rejects negative and non-integer amounts", () => {
    expect(() => normalizeItemToMonthlyCents(-100, "monthly")).toThrow(
      RangeError,
    );
    expect(() => normalizeItemToMonthlyCents(12.34, "monthly")).toThrow(
      RangeError,
    );
  });
});

describe("calculateMonthlyCashflow", () => {
  it("aggregates active inflows/outflows, tracks bySource, and ignores inactive items", () => {
    const items: DomainCashflowItem[] = [
      {
        id: "1",
        name: "Haushalts-Transfer A",
        direction: "inflow",
        amountCents: 250_000,
        frequency: "monthly",
        source: "finanz_cockpit_sync",
        active: true,
      },
      {
        id: "2",
        name: "Haushalts-Transfer B",
        direction: "inflow",
        amountCents: 200_000,
        frequency: "monthly",
        source: "manual",
        active: true,
      },
      {
        id: "3",
        name: "Grundsteuer Musterstraße 1",
        direction: "outflow",
        amountCents: 15_000,
        frequency: "quarterly",
        source: "manual",
        active: true,
      },
      {
        id: "4",
        name: "Hauskredit Musterbank",
        direction: "outflow",
        amountCents: 120_000,
        frequency: "monthly",
        source: "contract_linked",
        linkedContractId: "loan-1",
        active: true,
      },
      {
        id: "5",
        name: "Pausiertes Abo",
        direction: "outflow",
        amountCents: 50_000,
        frequency: "monthly",
        source: "manual",
        active: false,
      },
    ];

    const summary = calculateMonthlyCashflow(items);
    expect(summary.totalInflowCents).toBe(450_000);
    expect(summary.totalOutflowCents).toBe(125_000);
    expect(summary.monthlySurplusCents).toBe(325_000);
    expect(summary.isDeficit).toBe(false);
    expect(summary.normalizedItems).toHaveLength(4);
    expect(summary.bySource.finanz_cockpit_sync.netCents).toBe(250_000);
    expect(summary.bySource.manual.netCents).toBe(195_000);
    expect(summary.bySource.contract_linked.netCents).toBe(-120_000);
  });

  it("handles empty list, 0-cent items, and deficit cases", () => {
    expect(calculateMonthlyCashflow([])).toMatchObject({
      totalInflowCents: 0,
      totalOutflowCents: 0,
      monthlySurplusCents: 0,
      isDeficit: false,
    });

    const deficit = calculateMonthlyCashflow([
      {
        id: "in",
        name: "Einzahlung",
        direction: "inflow",
        amountCents: 100_000,
        frequency: "monthly",
        source: "manual",
        active: true,
      },
      {
        id: "out",
        name: "Ausgabe",
        direction: "outflow",
        amountCents: 150_000,
        frequency: "monthly",
        source: "manual",
        active: true,
      },
    ]);
    expect(deficit.monthlySurplusCents).toBe(-50_000);
    expect(deficit.isDeficit).toBe(true);
  });

  it("validates inactive items too and rejects invalid amounts", () => {
    expect(() =>
      calculateMonthlyCashflow([
        {
          id: "bad",
          name: "Ungültig",
          direction: "outflow",
          amountCents: -1,
          frequency: "monthly",
          source: "manual",
          active: false,
        },
      ]),
    ).toThrow(RangeError);
  });
});

describe("deriveContractCashflowItems", () => {
  it("derives monthly outflows only for active contracts with positive rate", () => {
    const contracts: DomainContract[] = [
      {
        id: "loan-1",
        name: "Hauskredit Musterbank",
        sphere: "household",
        category: "loan",
        status: "active",
        currentBalanceCents: 20_000_000,
        balanceAsOfDate: "2026-01-01",
        monthlyRateCents: 120_000,
        interestRateBps: 350,
      },
      {
        id: "loan-paused",
        name: "Pausiert",
        sphere: "household",
        category: "loan",
        status: "paused",
        currentBalanceCents: 500_000,
        balanceAsOfDate: "2026-01-01",
        monthlyRateCents: 10_000,
        interestRateBps: 0,
      },
      {
        id: "loan-lump",
        name: "Privatdarlehen",
        sphere: "household",
        category: "loan",
        status: "active",
        currentBalanceCents: 500_000,
        balanceAsOfDate: "2026-01-01",
        monthlyRateCents: 0,
        interestRateBps: 0,
        repaymentType: "lump_sum",
      },
      {
        id: "loan-personal",
        name: "Persönlicher Kredit Musterbank",
        sphere: "personal",
        category: "loan",
        status: "active",
        currentBalanceCents: 1_000_000,
        balanceAsOfDate: "2026-01-01",
        monthlyRateCents: 25_000,
        interestRateBps: 0,
        repaymentType: "installment",
      },
    ];

    const derived = deriveContractCashflowItems(contracts);
    expect(derived).toHaveLength(1);
    expect(derived[0]).toEqual({
      id: "contract:loan-1",
      name: "Hauskredit Musterbank",
      direction: "outflow",
      amountCents: 120_000,
      frequency: "monthly",
      source: "contract_linked",
      linkedContractId: "loan-1",
      active: true,
    });
  });
});

describe("calculateModeBCashflow", () => {
  const baseHousehold: ModeBHouseholdInput = {
    balanceCents: 425_000,
    recurringInflowCents: 460_000,
    recurringOutflowCents: 195_000,
    variableBudgetsCents: 95_000,
    variableRollingAvg3MCents: 104_500,
    variableRollingAvg6MCents: 99_200,
  };

  const manualItems: DomainCashflowItem[] = [
    {
      id: "m-in",
      name: "Kindergeld",
      direction: "inflow",
      amountCents: 25_000,
      frequency: "monthly",
      source: "manual",
      active: true,
    },
    {
      id: "m-out-yearly",
      name: "Musterverein",
      direction: "outflow",
      amountCents: 12_000,
      frequency: "yearly",
      source: "manual",
      active: true,
    },
    {
      id: "m-inactive",
      name: "Inaktiv",
      direction: "outflow",
      amountCents: 50_000,
      frequency: "monthly",
      source: "manual",
      active: false,
    },
  ];

  const contractItems: DomainCashflowItem[] = [
    {
      id: "contract:c1",
      name: "Hauskredit Musterbank",
      direction: "outflow",
      amountCents: 100_000,
      frequency: "monthly",
      source: "contract_linked",
      linkedContractId: "c1",
      active: true,
    },
  ];

  it("computes Mode B cashflow across all three variable basis modes", () => {
    const budgetMode = calculateModeBCashflow({
      household: baseHousehold,
      variableBasis: "budget",
      manualItems,
      contractItems,
      includeContractItems: false,
    });
    expect(budgetMode).toEqual({
      calibratedInflowCents: 460_000,
      calibratedFixedOutflowCents: 195_000,
      variableOutflowCents: 95_000,
      manualInflowCents: 25_000,
      manualOutflowCents: 1_000,
      contractOutflowCents: 0,
      totalInflowCents: 485_000,
      totalOutflowCents: 291_000,
      monthlySurplusCents: 194_000,
      isDeficit: false,
      selectedVariableBasis: "budget",
    });

    const avg3M = calculateModeBCashflow({
      household: baseHousehold,
      variableBasis: "avg_3m",
      manualItems,
    });
    expect(avg3M.variableOutflowCents).toBe(104_500);
    expect(avg3M.monthlySurplusCents).toBe(184_500);

    const avg6M = calculateModeBCashflow({
      household: baseHousehold,
      variableBasis: "avg_6m",
      manualItems,
    });
    expect(avg6M.variableOutflowCents).toBe(99_200);
    expect(avg6M.monthlySurplusCents).toBe(189_800);
  });

  it("includes derived contract outflows only when includeContractItems is true", () => {
    const withContracts = calculateModeBCashflow({
      household: baseHousehold,
      variableBasis: "budget",
      manualItems,
      contractItems,
      includeContractItems: true,
    });

    expect(withContracts.contractOutflowCents).toBe(100_000);
    expect(withContracts.totalOutflowCents).toBe(391_000);
    expect(withContracts.monthlySurplusCents).toBe(94_000);
  });

  it("handles 0-cent values, negative balanceCents, and deficit surplus", () => {
    const deficit = calculateModeBCashflow({
      household: {
        balanceCents: -25_000,
        recurringInflowCents: 0,
        recurringOutflowCents: 50_000,
        variableBudgetsCents: 0,
        variableRollingAvg3MCents: 0,
        variableRollingAvg6MCents: 0,
      },
      variableBasis: "budget",
      manualItems: [],
    });

    expect(deficit.monthlySurplusCents).toBe(-50_000);
    expect(deficit.isDeficit).toBe(true);
  });

  it("rejects floats and negative amounts in household metrics", () => {
    expect(() =>
      calculateModeBCashflow({
        household: { ...baseHousehold, recurringInflowCents: 12.34 },
        variableBasis: "budget",
        manualItems: [],
      }),
    ).toThrow(RangeError);

    expect(() =>
      calculateModeBCashflow({
        household: { ...baseHousehold, variableBudgetsCents: -100 },
        variableBasis: "budget",
        manualItems: [],
      }),
    ).toThrow(RangeError);
  });

  it("throws RangeError on safe-integer overflow during Mode B summation", () => {
    expect(() =>
      calculateModeBCashflow({
        household: {
          ...baseHousehold,
          recurringInflowCents: Number.MAX_SAFE_INTEGER,
        },
        variableBasis: "budget",
        manualItems: [
          {
            id: "m-overflow",
            name: "Overflow",
            direction: "inflow",
            amountCents: 100,
            frequency: "monthly",
            source: "manual",
            active: true,
          },
        ],
      }),
    ).toThrow(RangeError);
  });
});
