import { describe, expect, it } from "vitest";
import {
  calculateConsolidatedCashflow,
  deriveContractCashflowItems,
  derivePropertyCashflowItems,
  type DomainCashflowItem,
  type HouseholdCashflowInput,
  normalizeItemToMonthlyCents,
} from "@/domain/allocation/cashflow";
import type { DomainContract } from "@/domain/contracts/contract";

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
        category: "loan",
        status: "active",
        currentBalanceCents: 500_000,
        balanceAsOfDate: "2026-01-01",
        monthlyRateCents: 0,
        interestRateBps: 0,
        repaymentType: "lump_sum",
      },
      {
        id: "loan-closed",
        name: "Beendeter Kredit Musterbank",
        category: "loan",
        status: "closed",
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
      propertyInflowCents: 0,
      propertyOutflowCents: 0,
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
      propertyInflowCents: 0,
      propertyOutflowCents: 0,
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

describe("derivePropertyCashflowItems", () => {
  it("derives deterministic rent inflow and costs outflow only for rented properties with > 0 amounts", () => {
    const items = derivePropertyCashflowItems([
      {
        id: "prop-0",
        name: "Immobilie #0",
        usage: "owner_occupied",
        estimatedValueCents: 30_000_000,
        monthlyColdRentCents: 99_000, // legacy invalid value must be ignored
        monthlyNonRecoverableCostsCents: 5_000,
        monthlyMaintenanceAllowanceCents: null,
        depreciationBasisCents: null,
      },
      {
        id: "prop-1",
        name: "Wohnung Musterstraße 1",
        usage: "rented",
        estimatedValueCents: 25_000_000,
        monthlyColdRentCents: 80_000,
        monthlyNonRecoverableCostsCents: 6_000,
        monthlyMaintenanceAllowanceCents: 5_000,
        depreciationBasisCents: null,
      },
      {
        id: "prop-2",
        name: "Leerstand Musterweg 2",
        usage: "rented",
        estimatedValueCents: 15_000_000,
        monthlyColdRentCents: 0,
        monthlyNonRecoverableCostsCents: 0,
        monthlyMaintenanceAllowanceCents: null,
        depreciationBasisCents: null,
      },
    ]);

    expect(items).toEqual([
      {
        id: "property:prop-1:rent",
        name: "Wohnung Musterstraße 1 · Kaltmiete",
        direction: "inflow",
        amountCents: 80_000,
        frequency: "monthly",
        source: "property_linked",
        linkedPropertyId: "prop-1",
        active: true,
      },
      {
        id: "property:prop-1:costs",
        name: "Wohnung Musterstraße 1 · nicht umlagefähig",
        direction: "outflow",
        amountCents: 6_000,
        frequency: "monthly",
        source: "property_linked",
        linkedPropertyId: "prop-1",
        active: true,
      },
    ]);
  });
});

describe("calculateConsolidatedCashflow with propertyItems", () => {
  const household: HouseholdCashflowInput = {
    balanceCents: 100_000,
    recurringInflowCents: 400_000,
    recurringOutflowCents: 200_000,
    variableBudgetsCents: 50_000,
    variableRollingAvg3MCents: 50_000,
    variableRollingAvg6MCents: 50_000,
  };

  it("includes property inflow/outflow when includePropertyItems is true and zeroes them when false or omitted", () => {
    const propertyItems: DomainCashflowItem[] = [
      {
        id: "property:prop-1:rent",
        name: "Wohnung Musterstraße 1 · Kaltmiete",
        direction: "inflow",
        amountCents: 80_000,
        frequency: "monthly",
        source: "property_linked",
        linkedPropertyId: "prop-1",
        active: true,
      },
      {
        id: "property:prop-1:costs",
        name: "Wohnung Musterstraße 1 · nicht umlagefähig",
        direction: "outflow",
        amountCents: 6_000,
        frequency: "monthly",
        source: "property_linked",
        linkedPropertyId: "prop-1",
        active: true,
      },
    ];

    const baseline = calculateConsolidatedCashflow({
      household,
      variableBasis: "budget",
      manualItems: [],
    });
    expect(baseline.propertyInflowCents).toBe(0);
    expect(baseline.propertyOutflowCents).toBe(0);
    expect(baseline.monthlySurplusCents).toBe(150_000);

    const disabled = calculateConsolidatedCashflow({
      household,
      variableBasis: "budget",
      manualItems: [],
      propertyItems,
      includePropertyItems: false,
    });
    expect(disabled.propertyInflowCents).toBe(0);
    expect(disabled.propertyOutflowCents).toBe(0);
    expect(disabled.monthlySurplusCents).toBe(150_000);

    const enabled = calculateConsolidatedCashflow({
      household,
      variableBasis: "budget",
      manualItems: [],
      propertyItems,
      includePropertyItems: true,
    });
    expect(enabled.propertyInflowCents).toBe(80_000);
    expect(enabled.propertyOutflowCents).toBe(6_000);
    expect(enabled.monthlySurplusCents).toBe(150_000 + 80_000 - 6_000);
  });

  it("protects against cross-source injection, duplicate IDs across lists, and inactive items", () => {
    const result = calculateConsolidatedCashflow({
      household: null,
      variableBasis: "budget",
      manualItems: [
        {
          id: "dup-id",
          name: "Manuell",
          direction: "inflow",
          amountCents: 10_000,
          frequency: "monthly",
          source: "manual",
          active: true,
        },
        {
          id: "injected-prop-in-manual",
          name: "Injected",
          direction: "inflow",
          amountCents: 99_000,
          frequency: "monthly",
          source: "property_linked",
          active: true,
        },
      ],
      contractItems: [
        {
          id: "contract:c1",
          name: "Contract",
          direction: "outflow",
          amountCents: 20_000,
          frequency: "monthly",
          source: "contract_linked",
          active: true,
        },
        {
          id: "injected-prop-in-contract",
          name: "Injected",
          direction: "outflow",
          amountCents: 88_000,
          frequency: "monthly",
          source: "property_linked",
          active: true,
        },
      ],
      includeContractItems: true,
      propertyItems: [
        {
          id: "dup-id",
          name: "Dup ID in propertyItems",
          direction: "inflow",
          amountCents: 50_000,
          frequency: "monthly",
          source: "property_linked",
          active: true,
        },
        {
          id: "injected-contract-in-prop",
          name: "Injected",
          direction: "inflow",
          amountCents: 77_000,
          frequency: "monthly",
          source: "contract_linked",
          active: true,
        },
        {
          id: "inactive-prop",
          name: "Inactive",
          direction: "inflow",
          amountCents: 30_000,
          frequency: "monthly",
          source: "property_linked",
          active: false,
        },
        {
          id: "property:p1:rent",
          name: "Kaltmiete",
          direction: "inflow",
          amountCents: 60_000,
          frequency: "monthly",
          source: "property_linked",
          active: true,
        },
      ],
      includePropertyItems: true,
    });

    expect(result.manualInflowCents).toBe(10_000);
    expect(result.contractOutflowCents).toBe(20_000);
    expect(result.propertyInflowCents).toBe(60_000);
    expect(result.propertyOutflowCents).toBe(0);
    expect(result.monthlySurplusCents).toBe(50_000);
  });

  it("derives linked active household loan rates on rented properties and yields +300 EUR for 1.000 EUR rent and 700 EUR loan regardless of includeContractItems", () => {
    const rentedProperty = {
      id: "prop-rent-1",
      name: "Wohnung Musterstraße 1",
      usage: "rented" as const,
      estimatedValueCents: 25_000_000,
      monthlyColdRentCents: 100_000,
      monthlyNonRecoverableCostsCents: 0,
      monthlyMaintenanceAllowanceCents: 0,
      depreciationBasisCents: null,
    };
    const linkedLoan = {
      id: "loan-1",
      name: "Objektkredit Musterbank",
      category: "loan" as const,
      status: "active" as const,
      currentBalanceCents: 18_000_000,
      balanceAsOfDate: "2026-11-18",
      monthlyRateCents: 70_000,
      interestRateBps: 350,
      linkedPropertyId: "prop-rent-1",
    };

    const contractItems = deriveContractCashflowItems([linkedLoan]);
    const propertyItems = derivePropertyCashflowItems(
      [rentedProperty],
      [linkedLoan],
    );

    const withContractsOff = calculateConsolidatedCashflow({
      household: null,
      variableBasis: "budget",
      manualItems: [],
      contractItems,
      includeContractItems: false,
      propertyItems,
      includePropertyItems: true,
    });
    expect(withContractsOff.contractOutflowCents).toBe(0);
    expect(withContractsOff.propertyInflowCents).toBe(100_000);
    expect(withContractsOff.propertyOutflowCents).toBe(70_000);
    expect(withContractsOff.monthlySurplusCents).toBe(30_000);

    const withContractsOn = calculateConsolidatedCashflow({
      household: null,
      variableBasis: "budget",
      manualItems: [],
      contractItems,
      includeContractItems: true,
      propertyItems,
      includePropertyItems: true,
    });
    expect(withContractsOn.contractOutflowCents).toBe(70_000);
    expect(withContractsOn.propertyInflowCents).toBe(100_000);
    expect(withContractsOn.propertyOutflowCents).toBe(0);
    expect(withContractsOn.monthlySurplusCents).toBe(30_000);
  });
});
