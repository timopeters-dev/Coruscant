import { describe, expect, it } from "vitest";
import type { DomainLinkedContract } from "./properties";
import { summarizeProperties } from "./properties";
import {
  calculateRentalMetrics,
  type DomainRentalProperty,
  suggestTaxCategoryForPropertyUsage,
  summarizeRentalPortfolio,
  validateRentalProfile,
} from "./rental";

const AS_OF = "2026-11-01";

function makeRentedProperty(
  overrides: Partial<DomainRentalProperty> = {},
): DomainRentalProperty {
  return {
    id: "prop-rent-1",
    name: "Wohnung Musterstraße 1",
    usage: "rented",
    purchaseDate: "2024-01-01",
    purchasePriceCents: 25_000_000,
    estimatedValueCents: 26_000_000,
    monthlyColdRentCents: 80_000,
    monthlyNonRecoverableCostsCents: 6_000,
    monthlyMaintenanceAllowanceCents: 5_000,
    depreciationBasisCents: 18_000_000,
    ...overrides,
  };
}

function makeLoan(
  overrides: Partial<DomainLinkedContract> = {},
): DomainLinkedContract {
  return {
    id: "loan-1",
    name: "Objektkredit Musterbank",
    sphere: "household",
    category: "loan",
    status: "active",
    currentBalanceCents: 18_000_000,
    balanceAsOfDate: AS_OF,
    monthlyRateCents: 60_000,
    interestRateBps: 350,
    repaymentType: "annuity",
    linkedPropertyId: "prop-rent-1",
    ...overrides,
  };
}

describe("rental domain", () => {
  it("calculates happy-path rental metrics, yields, and tied capital", () => {
    const property = makeRentedProperty();
    const contracts = [makeLoan()];
    const summaries = summarizeProperties([property], contracts, AS_OF);

    const metrics = calculateRentalMetrics(
      property,
      summaries[property.id]!,
      contracts,
    );

    expect(metrics.monthlyColdRentCents).toBe(80_000);
    expect(metrics.monthlyNonRecoverableCostsCents).toBe(6_000);
    expect(metrics.monthlyMaintenanceAllowanceCents).toBe(5_000);
    expect(metrics.monthlyLoanRatesCents).toBe(60_000);
    expect(metrics.monthlySavingsRatesCents).toBe(0);
    expect(metrics.netCashflowBeforeReserveCents).toBe(14_000);
    expect(metrics.netCashflowAfterReserveCents).toBe(9_000);
    // Gross yield: 12 * 80_000 * 10_000 / 25_000_000 = 384 bps (3.84%)
    expect(metrics.grossYieldBps).toBe(384);
    // Net yield: 12 * (80_000 - 6_000 - 5_000) * 10_000 / 25_000_000 = 331.2 -> 331 bps
    expect(metrics.netYieldBps).toBe(331);
    expect(metrics.capitalTiedCents).toBe(8_000_000);
    expect(metrics.warnings).toEqual([]);
  });

  it("handles 0 rent with 0 gross yield and negative signed net yield and cashflow", () => {
    const property = makeRentedProperty({
      monthlyColdRentCents: 0,
      monthlyNonRecoverableCostsCents: 10_000,
      monthlyMaintenanceAllowanceCents: 5_000,
      purchasePriceCents: 20_000_000,
    });
    const contracts = [makeLoan({ monthlyRateCents: 50_000 })];
    const summaries = summarizeProperties([property], contracts, AS_OF);

    const metrics = calculateRentalMetrics(
      property,
      summaries[property.id]!,
      contracts,
    );

    expect(metrics.grossYieldBps).toBe(0);
    expect(metrics.netCashflowBeforeReserveCents).toBe(-60_000);
    expect(metrics.netCashflowAfterReserveCents).toBe(-65_000);
    // Net yield: 12 * (-15_000) * 10_000 / 20_000_000 = -90 bps
    expect(metrics.netYieldBps).toBe(-90);
  });

  it("treats all-null rental fields as 0 without throwing", () => {
    const property = makeRentedProperty({
      monthlyColdRentCents: null,
      monthlyNonRecoverableCostsCents: null,
      monthlyMaintenanceAllowanceCents: null,
      depreciationBasisCents: null,
    });
    const summaries = summarizeProperties([property], [], AS_OF);

    const metrics = calculateRentalMetrics(
      property,
      summaries[property.id]!,
      [],
    );

    expect(metrics.monthlyColdRentCents).toBe(0);
    expect(metrics.monthlyNonRecoverableCostsCents).toBe(0);
    expect(metrics.monthlyMaintenanceAllowanceCents).toBe(0);
    expect(metrics.netCashflowBeforeReserveCents).toBe(0);
    expect(metrics.netCashflowAfterReserveCents).toBe(0);
    expect(metrics.grossYieldBps).toBe(0);
    expect(metrics.netYieldBps).toBe(0);
  });

  it("returns null yields and missing_purchase_price warning when purchasePriceCents is null or 0", () => {
    for (const purchasePriceCents of [null, 0]) {
      const property = makeRentedProperty({ purchasePriceCents });
      const summaries = summarizeProperties([property], [], AS_OF);
      const metrics = calculateRentalMetrics(
        property,
        summaries[property.id]!,
        [],
      );
      expect(metrics.grossYieldBps).toBeNull();
      expect(metrics.netYieldBps).toBeNull();
      expect(metrics.warnings).toContainEqual({
        kind: "missing_purchase_price",
      });
    }
  });

  it("handles property without loans and 0 estimated value LTV = null", () => {
    const property = makeRentedProperty({ estimatedValueCents: 20_000_000 });
    const summaries = summarizeProperties([property], [], AS_OF);
    const metrics = calculateRentalMetrics(
      property,
      summaries[property.id]!,
      [],
    );

    expect(metrics.monthlyLoanRatesCents).toBe(0);
    expect(metrics.linkedLoanBalanceCents).toBe(0);
    expect(metrics.capitalTiedCents).toBe(20_000_000);
    expect(metrics.ltvBps).toBe(0);

    const zeroValueProp = makeRentedProperty({ estimatedValueCents: 0 });
    const zeroSummaries = summarizeProperties([zeroValueProp], [], AS_OF);
    const zeroMetrics = calculateRentalMetrics(
      zeroValueProp,
      zeroSummaries[zeroValueProp.id]!,
      [],
    );
    expect(zeroMetrics.ltvBps).toBeNull();
  });

  it("sums multiple active loans, excludes closed loans, and includes paused loan balance without rate", () => {
    const property = makeRentedProperty();
    const contracts: DomainLinkedContract[] = [
      makeLoan({ id: "l1", currentBalanceCents: 10_000_000, monthlyRateCents: 40_000 }),
      makeLoan({ id: "l2", currentBalanceCents: 5_000_000, monthlyRateCents: 20_000 }),
      makeLoan({
        id: "l-paused",
        status: "paused",
        currentBalanceCents: 2_000_000,
        monthlyRateCents: 15_000,
      }),
      makeLoan({
        id: "l-closed",
        status: "closed",
        currentBalanceCents: 9_000_000,
        monthlyRateCents: 50_000,
      }),
    ];

    const summaries = summarizeProperties([property], contracts, AS_OF);
    const metrics = calculateRentalMetrics(
      property,
      summaries[property.id]!,
      contracts,
    );

    expect(metrics.monthlyLoanRatesCents).toBe(60_000);
    expect(metrics.linkedLoanBalanceCents).toBe(17_000_000);
  });

  it("tracks linked savings_contract rate in monthlySavingsRatesCents without deducting savings balance from capitalTiedCents", () => {
    const property = makeRentedProperty({ estimatedValueCents: 25_000_000 });
    const contracts: DomainLinkedContract[] = [
      makeLoan({ id: "l1", currentBalanceCents: 15_000_000, monthlyRateCents: 50_000 }),
      {
        id: "bauspar-1",
        name: "Bausparer Musterkasse",
        sphere: "household",
        category: "savings_contract",
        status: "active",
        currentBalanceCents: 3_000_000,
        balanceAsOfDate: AS_OF,
        monthlyRateCents: 20_000,
        interestRateBps: 150,
        linkedPropertyId: property.id,
      },
    ];

    const summaries = summarizeProperties([property], contracts, AS_OF);
    const metrics = calculateRentalMetrics(
      property,
      summaries[property.id]!,
      contracts,
    );

    expect(metrics.monthlyLoanRatesCents).toBe(50_000);
    expect(metrics.monthlySavingsRatesCents).toBe(20_000);
    expect(metrics.linkedSavingsBalanceCents).toBe(3_000_000);
    // 80_000 - 6_000 - 50_000 - 20_000 = 4_000
    expect(metrics.netCashflowBeforeReserveCents).toBe(4_000);
    // 25_000_000 - 15_000_000 = 10_000_000 (savings balance not subtracted)
    expect(metrics.capitalTiedCents).toBe(10_000_000);
  });

  it("keeps active rate when projected balance reaches 0 (overpayment) and flags negative_equity when loan > value", () => {
    const property = makeRentedProperty({ estimatedValueCents: 10_000_000 });
    const overpaidLoan = makeLoan({
      id: "l-overpaid",
      currentBalanceCents: 10_000,
      balanceAsOfDate: "2026-01-01",
      monthlyRateCents: 50_000,
    });
    const overpaidSummaries = summarizeProperties([property], [overpaidLoan], AS_OF);
    const overpaidMetrics = calculateRentalMetrics(
      property,
      overpaidSummaries[property.id]!,
      [overpaidLoan],
    );
    expect(overpaidMetrics.linkedLoanBalanceCents).toBe(0);
    expect(overpaidMetrics.monthlyLoanRatesCents).toBe(50_000);

    const underwaterLoan = makeLoan({
      id: "l-underwater",
      currentBalanceCents: 12_000_000,
      balanceAsOfDate: AS_OF,
      monthlyRateCents: 40_000,
    });
    const underwaterSummaries = summarizeProperties(
      [property],
      [underwaterLoan],
      AS_OF,
    );
    const underwaterMetrics = calculateRentalMetrics(
      property,
      underwaterSummaries[property.id]!,
      [underwaterLoan],
    );
    expect(underwaterMetrics.capitalTiedCents).toBe(-2_000_000);
    expect(underwaterMetrics.ltvBps).toBe(12_000);
    expect(underwaterMetrics.warnings).toContainEqual({ kind: "negative_equity" });
  });

  it("emits personal_sphere_loan warning with contractId while still counting its rate in property view", () => {
    const property = makeRentedProperty();
    const personalLoan = makeLoan({
      id: "loan-personal-1",
      sphere: "personal",
      monthlyRateCents: 30_000,
    });
    const summaries = summarizeProperties([property], [personalLoan], AS_OF);
    const metrics = calculateRentalMetrics(
      property,
      summaries[property.id]!,
      [personalLoan],
    );

    expect(metrics.monthlyLoanRatesCents).toBe(30_000);
    expect(metrics.warnings).toContainEqual({
      kind: "personal_sphere_loan",
      contractId: "loan-personal-1",
    });
  });

  it("rounds exact .5 bps half-up for positive gross yield and symmetrically for negative net yield", () => {
    // 12 * 125 * 10_000 / 20_000 = 750? Let's craft exact .5 bps:
    // purchasePrice = 2_400_000, rent = 10_001 -> 12 * 10_001 * 10_000 / 2_400_000 = 500.05
    // Better: purchasePrice = 24_000, rent = 1 -> 12 * 1 * 10_000 / 24_000 = 5 bps
    // purchasePrice = 240_000, rent = 10 -> 5 bps. For .5 bps:
    // 12 * 10_000 / purchasePrice = 120_000 / purchasePrice.
    // Let purchasePrice = 80_000, rent = 1 -> 120_000 / 80_000 = 1.5 bps -> rounds to 2 bps!
    // For negative: costs = 1 -> 12 * (-1) * 10_000 / 80_000 = -1.5 bps -> rounds symmetrically to -2 bps!
    const property = makeRentedProperty({
      purchasePriceCents: 80_000,
      monthlyColdRentCents: 1,
      monthlyNonRecoverableCostsCents: 2,
      monthlyMaintenanceAllowanceCents: 0,
    });
    const summaries = summarizeProperties([property], [], AS_OF);
    const metrics = calculateRentalMetrics(
      property,
      summaries[property.id]!,
      [],
    );

    expect(metrics.grossYieldBps).toBe(2);
    expect(metrics.netYieldBps).toBe(-2);
  });

  it("throws on negative, non-integer, or NaN rental amounts", () => {
    const badValues = [-1, 12.5, Number.NaN];
    for (const bad of badValues) {
      const property = makeRentedProperty({ monthlyColdRentCents: bad });
      const summaries = summarizeProperties([property], [], AS_OF);
      expect(() =>
        calculateRentalMetrics(property, summaries[property.id]!, []),
      ).toThrow();
    }
  });

  describe("validateRentalProfile", () => {
    it("rejects each rental field on owner_occupied at its exact key", () => {
      const fields = [
        "monthlyColdRentCents",
        "monthlyNonRecoverableCostsCents",
        "monthlyMaintenanceAllowanceCents",
        "depreciationBasisCents",
      ] as const;

      for (const field of fields) {
        const errors = validateRentalProfile("owner_occupied", {
          [field]: 100,
        });
        expect(Object.keys(errors)).toEqual([field]);
      }
    });

    it("allows all-null on owner_occupied and values or nulls on rented", () => {
      expect(
        validateRentalProfile("owner_occupied", {
          monthlyColdRentCents: null,
          monthlyNonRecoverableCostsCents: null,
          monthlyMaintenanceAllowanceCents: null,
          depreciationBasisCents: null,
        }),
      ).toEqual({});

      expect(
        validateRentalProfile("rented", {
          monthlyColdRentCents: 80_000,
          monthlyNonRecoverableCostsCents: 6_000,
          monthlyMaintenanceAllowanceCents: 5_000,
          depreciationBasisCents: 18_000_000,
        }),
      ).toEqual({});

      expect(
        validateRentalProfile("rented", {
          monthlyColdRentCents: null,
          monthlyNonRecoverableCostsCents: null,
          monthlyMaintenanceAllowanceCents: null,
          depreciationBasisCents: null,
        }),
      ).toEqual({});
    });
  });

  describe("summarizeRentalPortfolio", () => {
    it("returns empty summary for 0 properties or only owner_occupied Immobilie #0", () => {
      const empty = summarizeRentalPortfolio([], [], AS_OF);
      expect(empty.hasData).toBe(false);
      expect(empty.propertyCount).toBe(0);
      expect(empty.grossYieldBps).toBeNull();
      expect(empty.netYieldBps).toBeNull();
      expect(empty.yieldCoverage).toBe("none");
      expect(empty.totals.monthlyColdRentCents).toBe(0);

      const ownerOnly = summarizeRentalPortfolio(
        [
          makeRentedProperty({
            id: "prop-0",
            name: "Immobilie #0",
            usage: "owner_occupied",
            monthlyColdRentCents: null,
            monthlyNonRecoverableCostsCents: null,
            monthlyMaintenanceAllowanceCents: null,
            depreciationBasisCents: null,
          }),
        ],
        [makeLoan({ linkedPropertyId: "prop-0" })],
        AS_OF,
      );
      expect(ownerOnly.hasData).toBe(false);
      expect(ownerOnly.propertyCount).toBe(0);
    });

    it("matches single-property metrics for 1 rented property", () => {
      const prop = makeRentedProperty();
      const contracts = [makeLoan()];
      const portfolio = summarizeRentalPortfolio([prop], contracts, AS_OF);
      const summaries = summarizeProperties([prop], contracts, AS_OF);
      const single = calculateRentalMetrics(prop, summaries[prop.id]!, contracts);

      expect(portfolio.hasData).toBe(true);
      expect(portfolio.propertyCount).toBe(1);
      expect(portfolio.totals.netCashflowBeforeReserveCents).toBe(
        single.netCashflowBeforeReserveCents,
      );
      expect(portfolio.grossYieldBps).toBe(single.grossYieldBps);
      expect(portfolio.netYieldBps).toBe(single.netYieldBps);
      expect(portfolio.yieldCoverage).toBe("all");
    });

    it("aggregates N rented properties, excludes owner_occupied, computes partial yieldCoverage, and avoids double-counting contracts", () => {
      const ownerProp = makeRentedProperty({
        id: "prop-0",
        name: "Immobilie #0",
        usage: "owner_occupied",
        estimatedValueCents: 40_000_000,
        monthlyColdRentCents: null,
        monthlyNonRecoverableCostsCents: null,
        monthlyMaintenanceAllowanceCents: null,
        depreciationBasisCents: null,
      });
      const rent1 = makeRentedProperty({
        id: "prop-1",
        purchasePriceCents: 20_000_000,
        estimatedValueCents: 22_000_000,
        monthlyColdRentCents: 80_000,
        monthlyNonRecoverableCostsCents: 5_000,
        monthlyMaintenanceAllowanceCents: 5_000,
      });
      const rent2 = makeRentedProperty({
        id: "prop-2",
        name: "Wohnung Musterstraße 2",
        purchasePriceCents: null,
        estimatedValueCents: 18_000_000,
        monthlyColdRentCents: 60_000,
        monthlyNonRecoverableCostsCents: 4_000,
        monthlyMaintenanceAllowanceCents: 3_000,
      });
      const contracts: DomainLinkedContract[] = [
        makeLoan({ id: "l-owner", linkedPropertyId: "prop-0", monthlyRateCents: 100_000 }),
        makeLoan({ id: "l-1", linkedPropertyId: "prop-1", currentBalanceCents: 10_000_000, monthlyRateCents: 50_000 }),
        makeLoan({ id: "l-unknown", linkedPropertyId: "prop-does-not-exist", currentBalanceCents: 5_000_000, monthlyRateCents: 25_000 }),
      ];

      const portfolio = summarizeRentalPortfolio(
        [ownerProp, rent1, rent2],
        contracts,
        AS_OF,
      );

      expect(portfolio.propertyCount).toBe(2);
      expect(portfolio.propertyIds).toEqual(["prop-1", "prop-2"]);
      expect(portfolio.totals.monthlyColdRentCents).toBe(140_000);
      expect(portfolio.totals.monthlyLoanRatesCents).toBe(50_000);
      expect(portfolio.totals.estimatedValueCents).toBe(40_000_000);
      expect(portfolio.totals.linkedLoanBalanceCents).toBe(10_000_000);
      expect(portfolio.totals.capitalTiedCents).toBe(30_000_000);
      expect(portfolio.yieldCoverage).toBe("partial");
      // Aggregated yield only over rent1 (purchasePrice 20_000_000): 12 * 80_000 * 10_000 / 20_000_000 = 480 bps
      expect(portfolio.grossYieldBps).toBe(480);
      // Net yield over rent1: 12 * (80_000 - 5_000 - 5_000) * 10_000 / 20_000_000 = 420 bps
      expect(portfolio.netYieldBps).toBe(420);
    });
  });

  describe("suggestTaxCategoryForPropertyUsage", () => {
    it("returns werbungskosten_vv for rented and null for owner_occupied", () => {
      expect(suggestTaxCategoryForPropertyUsage("rented")).toBe(
        "werbungskosten_vv",
      );
      expect(suggestTaxCategoryForPropertyUsage("owner_occupied")).toBeNull();
    });
  });
});
