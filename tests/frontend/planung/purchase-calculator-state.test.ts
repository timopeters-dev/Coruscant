import { describe, expect, it } from "vitest";
import { calculatePropertyPurchase } from "@/domain/planning/purchase";
import {
  buildBreakdownSegments,
  buildInitialFormState,
  buildPurchaseHints,
  defaultEquityForPot,
  formatBreakEvenEquityText,
  parseIntegerInput,
  pickDefaultEquityPot,
  type EquityPotOption,
} from "@/frontend/planung/purchase-calculator-state";

function makePot(overrides: Partial<EquityPotOption> = {}): EquityPotOption {
  return {
    id: "pot-1",
    name: "Topf Musterwohnung",
    priority: 1,
    currentCents: 1_000_000,
    targetCents: 5_000_000,
    ruleType: "fill_to_target",
    fixedMonthlyCents: null,
    remainderPercentage: null,
    targetDate: null,
    purpose: "goal",
    ...overrides,
  };
}

describe("purchase-calculator-state", () => {
  it("picks default equity pot: goal+targetDate before goal, sorted by priority then id", () => {
    expect(pickDefaultEquityPot([])).toBeNull();
    expect(
      pickDefaultEquityPot([makePot({ purpose: "emergency_fund" })]),
    ).toBeNull();

    const goalNoDate = makePot({ id: "b", priority: 1, targetDate: null });
    const goalWithDateLater = makePot({
      id: "c",
      priority: 2,
      targetDate: "2028-01-01",
    });
    const goalWithDateEarlier = makePot({
      id: "a",
      priority: 2,
      targetDate: "2027-06-01",
    });

    expect(
      pickDefaultEquityPot([
        goalNoDate,
        goalWithDateLater,
        goalWithDateEarlier,
      ])?.id,
    ).toBe("a");

    expect(
      pickDefaultEquityPot([
        makePot({ id: "z", priority: 2, targetDate: null }),
        makePot({ id: "a", priority: 1, targetDate: null }),
      ])?.id,
    ).toBe("a");
  });

  it("uses targetCents over currentCents and falls back without pot", () => {
    expect(
      defaultEquityForPot(
        makePot({ currentCents: 1_500_000, targetCents: 5_000_000 }),
        3_000_000,
      ),
    ).toBe(5_000_000);
    expect(
      defaultEquityForPot(
        makePot({ currentCents: 1_500_000, targetCents: null }),
        3_000_000,
      ),
    ).toBe(1_500_000);
    expect(defaultEquityForPot(null, 3_000_000)).toBe(3_000_000);
  });

  it("parses integer inputs strictly", () => {
    expect(parseIntegerInput("10")).toBe(10);
    expect(parseIntegerInput(" 40 ")).toBe(40);
    expect(parseIntegerInput("1,5")).toBeNull();
    expect(parseIntegerInput("-1")).toBeNull();
    expect(parseIntegerInput("")).toBeNull();
  });

  it("builds purchase hints for edge cases and stays empty in normal case", () => {
    const baseInput = buildInitialFormState(6_000_000);
    const normalResult = calculatePropertyPurchase(baseInput);
    expect(
      buildPurchaseHints(normalResult, null, {
        hasHouseholdData: true,
        isDummy: false,
      }),
    ).toEqual([]);

    const belowMin = calculatePropertyPurchase({
      ...baseInput,
      equityCents: 500_000,
    });
    const belowHints = buildPurchaseHints(belowMin, null, {
      hasHouseholdData: true,
      isDummy: false,
    });
    expect(belowHints.some((h) => h.text.includes("Bank finanziert Nebenkosten in der Regel nicht"))).toBe(true);

    const excessEq = calculatePropertyPurchase({
      ...baseInput,
      equityCents: 35_000_000,
    });
    expect(
      buildPurchaseHints(excessEq, null, {
        hasHouseholdData: true,
        isDummy: false,
      }).some((h) => h.key === "equity_exceeds_total"),
    ).toBe(true);

    const fullDebt = calculatePropertyPurchase({
      ...baseInput,
      requireEquityCoversCosts: false,
      equityCents: 0,
    });
    expect(
      buildPurchaseHints(fullDebt, null, {
        hasHouseholdData: true,
        isDummy: false,
      }).some((h) => h.key === "loan_finances_costs"),
    ).toBe(true);

    const noAmort = calculatePropertyPurchase({
      ...baseInput,
      initialRepaymentBps: 0,
    });
    expect(
      buildPurchaseHints(noAmort, null, {
        hasHouseholdData: true,
        isDummy: false,
      }).some((h) => h.key === "no_amortization"),
    ).toBe(true);

    const targetShortfallHints = buildPurchaseHints(
      normalResult,
      {
        potId: "pot-1",
        potName: "Topf Musterwohnung",
        currentCents: 2_000_000,
        targetCents: 4_000_000,
        gapNowCents: 4_000_000,
        coveredNow: false,
        targetCoversRequirement: false,
        targetShortfallCents: 2_000_000,
        deadline: null,
      },
      { hasHouseholdData: false, isDummy: true },
    );
    expect(targetShortfallHints.some((h) => h.key === "pot_target_shortfall")).toBe(true);
    const noHouseholdHint = targetShortfallHints.find(
      (h) => h.key === "no_household_data",
    );
    expect(noHouseholdHint?.text).toContain("Bespin");
    expect(noHouseholdHint?.text).toContain("manuelle Posten und Verträge");
    expect(noHouseholdHint?.text).not.toContain("0,00 €");
  });

  it("formats break-even equity text including 0-euro full-financing case", () => {
    expect(
      formatBreakEvenEquityText({
        monthlyColdRentCents: 100_000,
        equity: { kind: "unreachable" },
        equityGapToBreakEvenCents: null,
      }),
    ).toBe("trägt sich auch mit 100 % EK nicht");

    expect(
      formatBreakEvenEquityText({
        monthlyColdRentCents: 100_000,
        equity: { kind: "at_minimum", equityCents: 0 },
        equityGapToBreakEvenCents: 0,
      }),
    ).toBe("trägt sich auch bei Vollfinanzierung");

    expect(
      formatBreakEvenEquityText({
        monthlyColdRentCents: 100_000,
        equity: { kind: "at_minimum", equityCents: 3_000_000 },
        equityGapToBreakEvenCents: 0,
      }),
    ).toBe("trägt sich bereits mit dem Mindest-EK");
  });

  it("builds breakdown segments summing to 10_000 and handles 0 rent and all-zero", () => {
    const baseInput = buildInitialFormState(6_000_000);
    const baseResult = calculatePropertyPurchase(baseInput);
    const segs = buildBreakdownSegments(baseResult, baseInput);
    const sum =
      segs.segments.reduce((acc, s) => acc + s.widthBps, 0) +
      segs.surplusGapBps;
    expect(sum).toBe(10_000);

    const zeroRentInput = { ...baseInput, monthlyColdRentCents: 0 };
    const zeroRentResult = calculatePropertyPurchase(zeroRentInput);
    const zeroRentSegs = buildBreakdownSegments(zeroRentResult, zeroRentInput);
    expect(zeroRentSegs.rentWidthBps).toBe(0);
    expect(
      zeroRentSegs.segments.reduce((acc, s) => acc + s.widthBps, 0),
    ).toBe(10_000);

    const allZeroInput = {
      ...baseInput,
      purchasePriceCents: 0,
      equityCents: 0,
      monthlyColdRentCents: 0,
      monthlyNonRecoverableCostsCents: 0,
      monthlyMaintenanceCents: 0,
    };
    const allZeroResult = calculatePropertyPurchase(allZeroInput);
    const allZeroSegs = buildBreakdownSegments(allZeroResult, allZeroInput);
    expect(allZeroSegs.rentWidthBps).toBe(0);
    expect(allZeroSegs.surplusGapBps).toBe(0);
    expect(allZeroSegs.segments.every((s) => s.widthBps === 0)).toBe(true);
  });
});
