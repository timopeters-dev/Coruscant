import { describe, expect, it } from "vitest";
import { evaluatePotDeadlines, type DeadlinePotInput } from "./pot-deadline";
import {
  calculateHouseholdImpact,
  calculateLoanMonthlyRateCents,
  calculatePropertyPurchase,
  evaluateEquitySource,
  findMaxSelfSustainingLoanCents,
  projectRemainingDebt,
  type PropertyPurchaseInput,
} from "./property-purchase";
import { CURRENT_PURCHASE_COST_RULE_SET } from "./property-purchase-defaults";

function makeBaseInput(
  overrides: Partial<PropertyPurchaseInput> = {},
): PropertyPurchaseInput {
  return {
    purchasePriceCents: 25_000_000,
    costItems: CURRENT_PURCHASE_COST_RULE_SET.items.map(
      ({ key, label, bps }) => ({ key, label, bps }),
    ),
    equityCents: 6_000_000,
    requireEquityCoversCosts: true,
    interestRateBps: 350,
    initialRepaymentBps: 200,
    fixedRateYears: 10,
    monthlyColdRentCents: 80_000,
    monthlyNonRecoverableCostsCents: 6_000,
    monthlyMaintenanceCents: 5_000,
    ...overrides,
  };
}

describe("property-purchase domain", () => {
  it("computes the happy path accurately in integer cents", () => {
    const result = calculatePropertyPurchase(makeBaseInput());

    expect(result.costs.purchaseCostsCents).toBe(3_017_500);
    expect(result.costs.totalCostsCents).toBe(28_017_500);
    expect(result.equity.minimumCents).toBe(3_017_500);
    expect(result.equity.requiredCents).toBe(6_000_000);
    expect(result.equity.surplusEquityCents).toBe(0);
    expect(result.equity.shortfallToMinimumCents).toBe(0);

    expect(result.loan.principalCents).toBe(22_017_500);
    expect(result.loan.monthlyRateCents).toBe(100_914);
    expect(result.loan.firstMonthInterestCents).toBe(64_218);
    expect(result.loan.firstMonthPrincipalCents).toBe(36_696);
    expect(result.loan.fixedRateMonths).toBe(120);
    expect(result.loan.remainingDebtCents).toBeLessThan(22_017_500);
    expect(result.loan.paidOffInMonth).toBeNull();

    // R = 80_000 - 6_000 - 5_000 = 69_000
    expect(result.cashflow.netRentBeforeDebtServiceCents).toBe(69_000);
    // CF = 69_000 - 100_914 = -31_914
    expect(result.cashflow.monthlyCashflowCents).toBe(-31_914);
    expect(result.breakEven.monthlyColdRentCents).toBe(111_914);
  });

  it("rounds purchase costs half-up per item and sums rounded items", () => {
    // 5 * 1000 / 10_000 = 0.5 -> 1; 5 * 999 / 10_000 = 0.4995 -> 0; 5 * 1500 / 10_000 = 0.75 -> 1
    const result = calculatePropertyPurchase(
      makeBaseInput({
        purchasePriceCents: 5,
        costItems: [
          { key: "half", label: "Musterposten 0,5", bps: 1_000 },
          { key: "below", label: "Musterposten <0,5", bps: 999 },
          { key: "above", label: "Musterposten 0,75", bps: 1_500 },
        ],
        equityCents: 0,
      }),
    );

    expect(result.costs.items.map((i) => i.amountCents)).toEqual([1, 0, 1]);
    expect(result.costs.purchaseCostsCents).toBe(2);
    expect(result.costs.totalCostsCents).toBe(7);

    // 10 * 500 / 10_000 = 0.5 -> 1; 10 * 499 / 10_000 = 0.499 -> 0
    const resHalfUp = calculatePropertyPurchase(
      makeBaseInput({
        purchasePriceCents: 10,
        costItems: [
          { key: "up", label: "Aufrundung", bps: 500 },
          { key: "down", label: "Abrundung", bps: 499 },
        ],
        equityCents: 0,
      }),
    );
    expect(resHalfUp.costs.items.map((i) => i.amountCents)).toEqual([1, 0]);
    expect(resHalfUp.costs.purchaseCostsCents).toBe(1);
    expect(resHalfUp.costs.totalCostsCents).toBe(11);
  });

  it("handles 0% interest properly", () => {
    const result = calculatePropertyPurchase(
      makeBaseInput({
        purchasePriceCents: 10_000_000,
        costItems: [{ key: "fee", label: "Gebühr", bps: 0 }],
        equityCents: 0,
        interestRateBps: 0,
        initialRepaymentBps: 600,
        fixedRateYears: 20,
      }),
    );

    // rate = 10_000_000 * 600 / 120_000 = 50_000
    expect(result.loan.monthlyRateCents).toBe(50_000);
    expect(result.loan.firstMonthInterestCents).toBe(0);
    expect(result.loan.totalInterestInFixedPeriodCents).toBe(0);
    // 200 months * 50_000 = 10_000_000 -> paid off in month 200
    expect(result.loan.remainingDebtCents).toBe(0);
    expect(result.loan.paidOffInMonth).toBe(200);
  });

  it("handles 0% repayment (interest-only) and sets noAmortization flag", () => {
    const result = calculatePropertyPurchase(
      makeBaseInput({
        initialRepaymentBps: 0,
      }),
    );

    expect(result.loan.monthlyRateCents).toBe(
      result.loan.firstMonthInterestCents,
    );
    expect(result.loan.firstMonthPrincipalCents).toBe(0);
    expect(result.loan.remainingDebtCents).toBe(result.loan.principalCents);
    expect(result.flags.noAmortization).toBe(true);
  });

  it("handles 0% interest and 0% repayment", () => {
    const positiveRent = calculatePropertyPurchase(
      makeBaseInput({
        interestRateBps: 0,
        initialRepaymentBps: 0,
      }),
    );
    expect(positiveRent.loan.monthlyRateCents).toBe(0);
    expect(positiveRent.breakEven.equity).toEqual({
      kind: "at_minimum",
      equityCents: positiveRent.equity.minimumCents,
    });

    const negativeRent = calculatePropertyPurchase(
      makeBaseInput({
        interestRateBps: 0,
        initialRepaymentBps: 0,
        monthlyColdRentCents: 5_000,
        monthlyNonRecoverableCostsCents: 6_000,
        monthlyMaintenanceCents: 5_000,
      }),
    );
    expect(negativeRent.breakEven.equity).toEqual({ kind: "unreachable" });
  });

  it("handles 100% equity (E = G) and equity > totalCosts", () => {
    const fullEquity = calculatePropertyPurchase(
      makeBaseInput({ equityCents: 28_017_500 }),
    );
    expect(fullEquity.loan.principalCents).toBe(0);
    expect(fullEquity.loan.monthlyRateCents).toBe(0);
    expect(fullEquity.loan.remainingDebtCents).toBe(0);
    expect(fullEquity.flags.noLoan).toBe(true);
    expect(fullEquity.flags.equityExceedsTotal).toBe(false);
    expect(fullEquity.cashflow.monthlyCashflowCents).toBe(69_000);

    const excessEquity = calculatePropertyPurchase(
      makeBaseInput({ equityCents: 30_000_000 }),
    );
    expect(excessEquity.equity.requiredCents).toBe(28_017_500);
    expect(excessEquity.equity.surplusEquityCents).toBe(1_982_500);
    expect(excessEquity.loan.principalCents).toBe(0);
    expect(excessEquity.flags.equityExceedsTotal).toBe(true);
  });

  it("handles 0 cold rent with signed net yield and break-even rent", () => {
    const zeroRent = calculatePropertyPurchase(
      makeBaseInput({
        monthlyColdRentCents: 0,
        monthlyNonRecoverableCostsCents: 6_000,
        monthlyMaintenanceCents: 5_000,
      }),
    );

    expect(zeroRent.yields.grossYieldBps).toBe(0);
    // 12 * (-11_000) * 10_000 / 28_017_500 = -47.11... -> -47 bps
    expect(zeroRent.yields.netYieldBps).toBe(-47);
    expect(zeroRent.cashflow.monthlyCashflowCents).toBe(-(100_914 + 11_000));
    expect(zeroRent.breakEven.monthlyColdRentCents).toBe(100_914 + 11_000);
    expect(zeroRent.breakEven.equity).toEqual({ kind: "unreachable" });

    // R = 0 and k > 0 -> amount = G - L* (very close to G)
    const zeroNetRent = calculatePropertyPurchase(
      makeBaseInput({
        monthlyColdRentCents: 11_000,
        monthlyNonRecoverableCostsCents: 6_000,
        monthlyMaintenanceCents: 5_000,
      }),
    );
    expect(zeroNetRent.cashflow.netRentBeforeDebtServiceCents).toBe(0);
    expect(zeroNetRent.breakEven.equity.kind).toBe("amount");
    if (zeroNetRent.breakEven.equity.kind === "amount") {
      const checkAtBE = calculatePropertyPurchase(
        makeBaseInput({
          monthlyColdRentCents: 11_000,
          monthlyNonRecoverableCostsCents: 6_000,
          monthlyMaintenanceCents: 5_000,
          equityCents: zeroNetRent.breakEven.equity.equityCents,
        }),
      );
      expect(checkAtBE.cashflow.monthlyCashflowCents).toBeGreaterThanOrEqual(0);
    }
  });

  it("calculates household impact symmetrically", () => {
    const impactNegative = calculateHouseholdImpact(50_000, -80_000);
    expect(impactNegative.monthlySurplusAfterCents).toBe(-30_000);
    expect(impactNegative.isDeficitAfter).toBe(true);
    expect(impactNegative.objectBurdenCents).toBe(80_000);

    const impactPositive = calculateHouseholdImpact(50_000, 20_000);
    expect(impactPositive.monthlySurplusAfterCents).toBe(70_000);
    expect(impactPositive.isDeficitAfter).toBe(false);
    expect(impactPositive.objectBurdenCents).toBe(0);
  });

  it("rounds annuity half-up at exact boundaries and handles early payoff", () => {
    expect(calculateLoanMonthlyRateCents(100, 600, 0)).toBe(1);
    expect(calculateLoanMonthlyRateCents(99, 600, 0)).toBe(0);

    const fastPayoff = projectRemainingDebt(1_000_000, 300, 100_000, 480);
    expect(fastPayoff.remainingDebtCents).toBe(0);
    expect(fastPayoff.paidOffInMonth).toBe(11);

    const result = calculatePropertyPurchase(
      makeBaseInput({
        purchasePriceCents: 10_000_000,
        costItems: [{ key: "fee", label: "Gebühr", bps: 0 }],
        equityCents: 0,
        interestRateBps: 300,
        initialRepaymentBps: 1_000,
        fixedRateYears: 40,
      }),
    );
    expect(result.loan.remainingDebtCents).toBe(0);
    expect(result.loan.paidOffInMonth).not.toBeNull();
    expect(result.loan.paidOffInMonth!).toBeLessThan(480);
  });

  it("verifies closed-form break-even loan over a grid and against binary search", () => {
    const netRents = [0, 1, 59_999, 100_000, 250_000];
    const ks = [1, 550, 2_500];

    for (const r of netRents) {
      for (const k of ks) {
        const interest = Math.floor(k / 2);
        const repayment = k - interest;
        const lStar = findMaxSelfSustainingLoanCents(r, interest, repayment)!;

        expect(calculateLoanMonthlyRateCents(lStar, interest, repayment)).toBeLessThanOrEqual(r);
        expect(calculateLoanMonthlyRateCents(lStar + 1, interest, repayment)).toBeGreaterThan(r);

        // Compare against binary search on [0, lStar + 1000]
        let lo = 0;
        let hi = lStar + 1_000;
        while (lo < hi) {
          const mid = Math.floor((lo + hi + 1) / 2);
          if (calculateLoanMonthlyRateCents(mid, interest, repayment) <= r) {
            lo = mid;
          } else {
            hi = mid - 1;
          }
        }
        expect(lStar).toBe(lo);
      }
    }
  });

  it("handles break-even edge cases and round-trip invariants", () => {
    // 1. unreachable
    const unreachable = calculatePropertyPurchase(
      makeBaseInput({
        monthlyColdRentCents: 5_000,
        monthlyNonRecoverableCostsCents: 6_000,
        monthlyMaintenanceCents: 5_000,
      }),
    );
    expect(unreachable.breakEven.equity).toEqual({ kind: "unreachable" });
    expect(unreachable.breakEven.equityGapToBreakEvenCents).toBeNull();

    // 2. at_minimum (high rent, switch on)
    const atMinimum = calculatePropertyPurchase(
      makeBaseInput({ monthlyColdRentCents: 300_000 }),
    );
    expect(atMinimum.breakEven.equity).toEqual({
      kind: "at_minimum",
      equityCents: atMinimum.equity.minimumCents,
    });

    // 3. switch off and high rent -> at_minimum with 0
    const atZero = calculatePropertyPurchase(
      makeBaseInput({
        requireEquityCoversCosts: false,
        monthlyColdRentCents: 300_000,
      }),
    );
    expect(atZero.breakEven.equity).toEqual({
      kind: "at_minimum",
      equityCents: 0,
    });

    // 4. Round-trip for break-even rent and break-even equity (kind === "amount")
    const base = calculatePropertyPurchase(makeBaseInput());
    expect(base.breakEven.equity.kind).toBe("amount");
    const atBeRent = calculatePropertyPurchase(
      makeBaseInput({
        monthlyColdRentCents: base.breakEven.monthlyColdRentCents,
      }),
    );
    expect(atBeRent.cashflow.monthlyCashflowCents).toBe(0);

    if (base.breakEven.equity.kind === "amount") {
      const beEq = base.breakEven.equity.equityCents;
      const atBeEq = calculatePropertyPurchase(
        makeBaseInput({ equityCents: beEq }),
      );
      expect(atBeEq.cashflow.monthlyCashflowCents).toBeGreaterThanOrEqual(0);

      const oneCentLess = calculatePropertyPurchase(
        makeBaseInput({ equityCents: beEq - 1 }),
      );
      expect(oneCentLess.cashflow.monthlyCashflowCents).toBeLessThan(0);
    }
  });

  it("enforces minimum equity when E < M and allows cost financing when switch is off", () => {
    const belowMin = calculatePropertyPurchase(
      makeBaseInput({ equityCents: 1_000_000 }),
    );
    expect(belowMin.equity.requiredCents).toBe(3_017_500);
    expect(belowMin.equity.shortfallToMinimumCents).toBe(2_017_500);
    expect(belowMin.loan.principalCents).toBe(25_000_000);
    expect(belowMin.flags.belowMinimumEquity).toBe(true);
    expect(belowMin.flags.loanFinancesPurchaseCosts).toBe(false);

    const switchOff = calculatePropertyPurchase(
      makeBaseInput({
        requireEquityCoversCosts: false,
        equityCents: 0,
      }),
    );
    expect(switchOff.equity.minimumCents).toBe(0);
    expect(switchOff.equity.requiredCents).toBe(0);
    expect(switchOff.loan.principalCents).toBe(28_017_500);
    expect(switchOff.flags.belowMinimumEquity).toBe(false);
    expect(switchOff.flags.loanFinancesPurchaseCosts).toBe(true);
  });

  it("preserves M <= G invariant for P = 0 and max cost items", () => {
    const zeroPrice = calculatePropertyPurchase(
      makeBaseInput({ purchasePriceCents: 0, equityCents: 0 }),
    );
    expect(zeroPrice.costs.totalCostsCents).toBe(0);
    expect(zeroPrice.equity.minimumCents).toBe(0);
    expect(zeroPrice.yields.grossYieldBps).toBeNull();
    expect(zeroPrice.yields.netYieldBps).toBeNull();

    const maxItems = Array.from({ length: 10 }, (_, idx) => ({
      key: `k${idx}`,
      label: `Posten ${idx}`,
      bps: 2_000,
    }));
    const highCosts = calculatePropertyPurchase(
      makeBaseInput({
        purchasePriceCents: 10_000_000,
        costItems: maxItems,
        equityCents: 0,
      }),
    );
    expect(highCosts.equity.minimumCents).toBeLessThanOrEqual(
      highCosts.costs.totalCostsCents,
    );
    expect(highCosts.loan.principalCents).toBe(10_000_000);
  });

  it("throws RangeError for invalid domain inputs", () => {
    const badCases: Partial<PropertyPurchaseInput>[] = [
      { purchasePriceCents: -1 },
      { purchasePriceCents: 100.5 },
      { purchasePriceCents: Number.NaN },
      { interestRateBps: 1_501 },
      { initialRepaymentBps: 1_001 },
      { fixedRateYears: 0 },
      { fixedRateYears: 41 },
      { fixedRateYears: 1.5 },
      { costItems: [] },
      {
        costItems: Array.from({ length: 11 }, (_, idx) => ({
          key: `k${idx}`,
          label: `Posten ${idx}`,
          bps: 100,
        })),
      },
      { costItems: [{ key: "a", label: "A", bps: 2_001 }] },
      {
        costItems: [
          { key: "dup", label: "A", bps: 100 },
          { key: "dup", label: "B", bps: 200 },
        ],
      },
    ];

    for (const bad of badCases) {
      expect(() => calculatePropertyPurchase(makeBaseInput(bad))).toThrow(
        RangeError,
      );
    }
  });

  it("evaluates equity source pot including deadlines and target shortfalls", () => {
    expect(
      evaluateEquitySource({
        requiredEquityCents: 5_000_000,
        pot: null,
        deadlines: [],
      }),
    ).toBeNull();

    const potNoDate: DeadlinePotInput = {
      id: "pot-musterwohnung",
      name: "Topf Musterwohnung",
      priority: 1,
      currentCents: 2_000_000,
      targetCents: 4_000_000,
      ruleType: "fill_to_target",
      fixedMonthlyCents: null,
      remainderPercentage: null,
      targetDate: null,
    };
    const evalNoDate = evaluateEquitySource({
      requiredEquityCents: 5_000_000,
      pot: potNoDate,
      deadlines: [],
    })!;
    expect(evalNoDate.deadline).toBeNull();
    expect(evalNoDate.gapNowCents).toBe(3_000_000);
    expect(evalNoDate.coveredNow).toBe(false);
    expect(evalNoDate.targetCoversRequirement).toBe(false);
    expect(evalNoDate.targetShortfallCents).toBe(1_000_000);

    const potNoTarget: DeadlinePotInput = {
      ...potNoDate,
      targetCents: null,
      currentCents: 6_000_000,
    };
    const evalNoTarget = evaluateEquitySource({
      requiredEquityCents: 5_000_000,
      pot: potNoTarget,
      deadlines: [],
    })!;
    expect(evalNoTarget.targetCoversRequirement).toBeNull();
    expect(evalNoTarget.coveredNow).toBe(true);
    expect(evalNoTarget.gapNowCents).toBe(0);

    const potWithDeadline: DeadlinePotInput = {
      ...potNoDate,
      targetDate: "2027-03-01",
    };
    const deadlines = evaluatePotDeadlines({
      pots: [potWithDeadline],
      monthlySurplusCents: 10_000,
      todayIsoDate: "2026-11-18",
    });
    const evalWithDeadline = evaluateEquitySource({
      requiredEquityCents: 5_000_000,
      pot: potWithDeadline,
      deadlines,
    })!;
    expect(evalWithDeadline.deadline?.status).toBe("at_risk");
  });
});
