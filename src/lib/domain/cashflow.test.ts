import { describe, expect, it } from "vitest";
import {
  calculateConsolidatedCashflow,
  deriveContractCashflowItems,
  type DomainCashflowItem,
  type HouseholdCashflowInput,
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

describe("calculateConsolidatedCashflow", () => {
  const baseHousehold: HouseholdCashflowInput = {
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
      id: "m-out-quarterly",
      name: "Mustergebühr Quartal",
      direction: "outflow",
      amountCents: 9_000,
      frequency: "quarterly",
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

  it("computes consolidated cashflow across all three variable basis modes", () => {
    const budgetMode = calculateConsolidatedCashflow({
      household: baseHousehold,
      variableBasis: "budget",
      manualItems,
      contractItems,
      includeContractItems: false,
    });
    expect(budgetMode).toEqual({
      hasHouseholdData: true,
      calibratedInflowCents: 460_000,
      calibratedFixedOutflowCents: 195_000,
      variableOutflowCents: 95_000,
      manualInflowCents: 25_000,
      manualOutflowCents: 4_000,
      contractOutflowCents: 0,
      totalInflowCents: 485_000,
      totalOutflowCents: 294_000,
      monthlySurplusCents: 191_000,
      isDeficit: false,
      selectedVariableBasis: "budget",
    });

    const avg3M = calculateConsolidatedCashflow({
      household: baseHousehold,
      variableBasis: "avg_3m",
      manualItems,
    });
    expect(avg3M.variableOutflowCents).toBe(104_500);
    expect(avg3M.monthlySurplusCents).toBe(181_500);

    const avg6M = calculateConsolidatedCashflow({
      household: baseHousehold,
      variableBasis: "avg_6m",
      manualItems,
    });
    expect(avg6M.variableOutflowCents).toBe(99_200);
    expect(avg6M.monthlySurplusCents).toBe(186_800);
  });

  it("includes derived contract outflows only when includeContractItems is true", () => {
    const withoutContracts = calculateConsolidatedCashflow({
      household: baseHousehold,
      variableBasis: "budget",
      manualItems,
      contractItems,
    });
    expect(withoutContracts.contractOutflowCents).toBe(0);

    const withContracts = calculateConsolidatedCashflow({
      household: baseHousehold,
      variableBasis: "budget",
      manualItems,
      contractItems,
      includeContractItems: true,
    });

    expect(withContracts.contractOutflowCents).toBe(100_000);
    expect(withContracts.totalOutflowCents).toBe(394_000);
    expect(withContracts.monthlySurplusCents).toBe(91_000);
  });

  it("handles household: null gracefully with 0-cent bank metrics and manual/contract items", () => {
    const summary = calculateConsolidatedCashflow({
      household: null,
      variableBasis: "avg_3m",
      manualItems,
      contractItems,
      includeContractItems: true,
    });

    expect(summary).toEqual({
      hasHouseholdData: false,
      calibratedInflowCents: 0,
      calibratedFixedOutflowCents: 0,
      variableOutflowCents: 0,
      manualInflowCents: 25_000,
      manualOutflowCents: 4_000,
      contractOutflowCents: 100_000,
      totalInflowCents: 25_000,
      totalOutflowCents: 104_000,
      monthlySurplusCents: -79_000,
      isDeficit: true,
      selectedVariableBasis: "avg_3m",
    });
  });

  it("handles 0-cent values, negative balanceCents, and deficit surplus", () => {
    const deficit = calculateConsolidatedCashflow({
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

  it("rejects floats and negative amounts in household metrics and active/inactive items", () => {
    expect(() =>
      calculateConsolidatedCashflow({
        household: { ...baseHousehold, recurringInflowCents: 12.34 },
        variableBasis: "budget",
        manualItems: [],
      }),
    ).toThrow(RangeError);

    expect(() =>
      calculateConsolidatedCashflow({
        household: { ...baseHousehold, variableBudgetsCents: -100 },
        variableBasis: "budget",
        manualItems: [],
      }),
    ).toThrow(RangeError);

    expect(() =>
      calculateConsolidatedCashflow({
        household: null,
        variableBasis: "budget",
        manualItems: [
          {
            id: "bad-inactive",
            name: "Invalid Inactive",
            direction: "outflow",
            amountCents: -50,
            frequency: "monthly",
            source: "manual",
            active: false,
          },
        ],
      }),
    ).toThrow(RangeError);

    expect(() =>
      calculateConsolidatedCashflow({
        household: null,
        variableBasis: "budget",
        manualItems: [],
        contractItems: [
          {
            id: "contract:bad",
            name: "Float Contract",
            direction: "outflow",
            amountCents: 10.5,
            frequency: "monthly",
            source: "contract_linked",
            active: false,
          },
        ],
        includeContractItems: false,
      }),
    ).toThrow(RangeError);
  });

  it("throws RangeError on safe-integer overflow during summation", () => {
    expect(() =>
      calculateConsolidatedCashflow({
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
