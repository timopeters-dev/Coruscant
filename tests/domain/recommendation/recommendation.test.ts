import { describe, expect, it } from "vitest";
import { computeRecommendationFingerprint, recommendMonthlySavings, recommendUse } from "@/domain/recommendation/recommendation";
import { DEFAULT_RECOMMENDATION_ASSUMPTIONS, validateRecommendationAssumptions, type RecommendationLoan, type RecommendationPot, type RecommendationState } from "@/domain/recommendation/types";
import type { RateCorridor } from "@/domain/contracts/loan-options";
import { findBreakEvenReturnBps } from "@/domain/planning/prepayment-vs-etf";

function makePot(overrides: Partial<RecommendationPot> = {}): RecommendationPot {
  const hasTarget = overrides.targetCents !== undefined && overrides.targetCents !== null;
  return {
    id: "pot-1",
    name: "Notgroschen",
    priority: 1,
    purpose: "emergency_fund",
    currentCents: 0,
    targetCents: null,
    targetDate: null,
    ruleType: hasTarget ? "fill_to_target" : "fixed_monthly",
    fixedMonthlyCents: hasTarget ? null : 0,
    linkedContractId: null,
    ...overrides,
  };
}

function makeLoan(overrides: Partial<RecommendationLoan> = {}): RecommendationLoan {
  return {
    id: "loan-1",
    balanceCents: 10_000_000,
    interestRateBps: 350,
    monthlyRateCents: 80_000,
    repaymentType: "annuity",
    specialRepaymentMaxYearlyCents: 500_000,
    fixedInterestUntil: "2032-11-01",
    futureLoanInterestRateBps: null,
    ...overrides,
  };
}

function makeState(overrides: Partial<RecommendationState> = {}): RecommendationState {
  return {
    asOfDate: "2026-11-19",
    monthlyExpensesCents: 250_000,
    monthlySurplusCents: 100_000,
    pots: [],
    loans: [],
    ...overrides,
  };
}

describe("validateRecommendationAssumptions", () => {
  it("returns defaults when omitted and rejects out-of-range values", () => {
    expect(validateRecommendationAssumptions()).toEqual(
      DEFAULT_RECOMMENDATION_ASSUMPTIONS,
    );
    expect(() =>
      validateRecommendationAssumptions({ emergencyFundMonths: 0 }),
    ).toThrow(RangeError);
    expect(() =>
      validateRecommendationAssumptions({ emergencyFundMonths: 13 }),
    ).toThrow(RangeError);
    expect(() =>
      validateRecommendationAssumptions({ safetyMarginBps: 600 }),
    ).toThrow(RangeError);
    expect(() =>
      validateRecommendationAssumptions({
        churchTaxBps: 700 as unknown as 0,
      }),
    ).toThrow(RangeError);
    expect(() =>
      validateRecommendationAssumptions({ saverAllowanceCents: -1 }),
    ).toThrow(RangeError);
    expect(() =>
      validateRecommendationAssumptions({
        specialRepaymentUsedThisYearCentsByLoanId: { "loan-1": -100 },
      }),
    ).toThrow(RangeError);
  });

  it("ignores unknown loan IDs in specialRepaymentUsedThisYearCentsByLoanId", () => {
    const res = recommendUse(
      100_000,
      makeState({
        monthlyExpensesCents: 0,
        pots: [makePot({ purpose: "emergency_fund", targetCents: 0 })],
      }),
      {
        specialRepaymentUsedThisYearCentsByLoanId: { "unknown-loan": 50_000 },
      },
    );
    expect(res.items).toHaveLength(1);
    expect(res.items[0]?.amountCents).toBe(100_000);
  });
});

describe("recommendUse", () => {
  it("handles X = 0 and rejects negative or non-integer X", () => {
    const zero = recommendUse(0, makeState());
    expect(zero.items).toEqual([]);
    expect(zero.notes).toEqual([{ code: "AMOUNT_ZERO" }]);

    expect(() => recommendUse(-1, makeState())).toThrow(RangeError);
    expect(() => recommendUse(12.34, makeState())).toThrow(RangeError);
  });

  it("handles emergency fund: empty rule-based, full, pot-target, no pot, unknown target, and partial fill", () => {
    // Empty rule-based (0 EUR, 2500 EUR expenses, 3 months -> 7500 EUR)
    const emptyRule = recommendUse(
      1_000_000,
      makeState({
        pots: [makePot({ id: "pot-ef", purpose: "emergency_fund", currentCents: 0 })],
      }),
    );
    expect(emptyRule.items[0]).toMatchObject({
      kind: "emergency_fund",
      amountCents: 750_000,
      target: { type: "pot", potId: "pot-ef" },
    });
    expect(emptyRule.items[0]?.reasons[0]).toMatchObject({
      code: "EMERGENCY_FUND_GAP",
      targetSource: "rule",
      targetCents: 750_000,
    });

    // Full emergency fund
    const full = recommendUse(
      500_000,
      makeState({
        pots: [
          makePot({
            id: "pot-ef",
            purpose: "emergency_fund",
            currentCents: 750_000,
          }),
        ],
      }),
    );
    expect(full.notes).toContainEqual({
      code: "EMERGENCY_FUND_FULL",
      currentCents: 750_000,
      targetCents: 750_000,
    });
    expect(full.items.every((i) => i.kind !== "emergency_fund")).toBe(true);

    // Pot-target set -> targetSource: "pots"
    const potTarget = recommendUse(
      500_000,
      makeState({
        pots: [
          makePot({
            id: "pot-ef",
            purpose: "emergency_fund",
            currentCents: 100_000,
            targetCents: 400_000,
          }),
        ],
      }),
    );
    expect(potTarget.items[0]).toMatchObject({
      kind: "emergency_fund",
      amountCents: 300_000,
    });
    expect(potTarget.items[0]?.reasons[0]).toMatchObject({
      code: "EMERGENCY_FUND_GAP",
      targetSource: "pots",
      targetCents: 400_000,
    });

    // No emergency pot -> target: none + EMERGENCY_FUND_NO_POT
    const noPot = recommendUse(200_000, makeState({ pots: [] }));
    expect(noPot.items[0]).toMatchObject({
      kind: "emergency_fund",
      amountCents: 200_000,
      target: { type: "none" },
    });
    expect(noPot.items[0]?.reasons.map((r) => r.code)).toContain(
      "EMERGENCY_FUND_NO_POT",
    );

    // Expenses null without pot target -> EMERGENCY_TARGET_UNKNOWN
    const unknownTarget = recommendUse(
      200_000,
      makeState({ monthlyExpensesCents: null, pots: [] }),
    );
    expect(unknownTarget.notes).toContainEqual({
      code: "EMERGENCY_TARGET_UNKNOWN",
    });

    // X smaller than gap -> single item = X
    const smallX = recommendUse(
      100_000,
      makeState({
        pots: [makePot({ id: "pot-ef", purpose: "emergency_fund", currentCents: 0 })],
      }),
    );
    expect(smallX.items).toHaveLength(1);
    expect(smallX.items[0]?.amountCents).toBe(100_000);
  });

  it("handles pot deadlines: shortfallAtDeadline, on_track, beyond shortHorizon, unreachable, overdue, no deadline", () => {
    const state = makeState({
      monthlyExpensesCents: 0,
      monthlySurplusCents: 50_000,
      pots: [
        makePot({
          id: "pot-near",
          name: "Urlaub",
          priority: 1,
          purpose: "goal",
          currentCents: 100_000,
          targetCents: 400_000,
          targetDate: "2027-03-01", // 4 months away
          ruleType: "fixed_monthly",
          fixedMonthlyCents: 50_000, // 4 * 500 = 2000, so shortfallAtDeadline = 1000
        }),
        makePot({
          id: "pot-far",
          name: "Weit",
          priority: 2,
          purpose: "goal",
          currentCents: 0,
          targetCents: 500_000,
          targetDate: "2032-01-01", // > 36 months
          ruleType: "fill_to_target",
        }),
        makePot({
          id: "pot-nodate",
          name: "OhneDatum",
          priority: 3,
          purpose: "goal",
          currentCents: 0,
          targetCents: 100_000,
          targetDate: null,
          ruleType: "fill_to_target",
        }),
      ],
    });

    const res = recommendUse(500_000, state);
    const nearItem = res.items.find(
      (i) => i.target.type === "pot" && i.target.potId === "pot-near",
    );
    expect(nearItem).toBeDefined();
    expect(nearItem?.amountCents).toBeLessThan(300_000);
    expect(res.notes).toContainEqual({
      code: "POT_NO_DEADLINE_SKIPPED",
      potId: "pot-nodate",
    });
    expect(
      res.items.some(
        (i) => i.target.type === "pot" && i.target.potId === "pot-far",
      ),
    ).toBe(false);

    // Unreachable deadline
    const unreachable = recommendUse(
      100_000,
      makeState({
        monthlyExpensesCents: 0,
        monthlySurplusCents: 0,
        pots: [
          makePot({
            id: "pot-overdue",
            purpose: "goal",
            currentCents: 0,
            targetCents: 500_000,
            targetDate: "2026-10-01",
          }),
        ],
      }),
    );
    expect(unreachable.items[0]?.reasons).toContainEqual({
      code: "POT_DEADLINE_UNREACHABLE",
      targetMonth: "2026-10",
      remainingGapCents: 400_000,
    });

    // On track pot
    const onTrack = recommendUse(
      100_000,
      makeState({
        monthlyExpensesCents: 0,
        monthlySurplusCents: 100_000,
        pots: [
          makePot({
            id: "pot-ok",
            purpose: "goal",
            currentCents: 100_000,
            targetCents: 200_000,
            targetDate: "2027-03-01",
            ruleType: "fixed_monthly",
            fixedMonthlyCents: 50_000,
          }),
        ],
      }),
    );
    expect(onTrack.notes).toContainEqual({
      code: "POT_ON_TRACK",
      potId: "pot-ok",
      targetMonth: "2027-03",
    });
  });

  it("handles no loans and investment pot headroom", () => {
    const withInvPot = recommendUse(
      300_000,
      makeState({
        monthlyExpensesCents: 0,
        pots: [
          makePot({
            id: "pot-inv",
            purpose: "investment",
            currentCents: 100_000,
            targetCents: 500_000,
          }),
        ],
      }),
    );
    expect(withInvPot.items[0]).toMatchObject({
      kind: "etf",
      amountCents: 300_000,
      target: { type: "pot", potId: "pot-inv" },
      reasons: [{ code: "ETF_NO_LOAN" }],
    });

    const tooSmallHeadroom = recommendUse(
      500_000,
      makeState({
        monthlyExpensesCents: 0,
        pots: [
          makePot({
            id: "pot-inv",
            purpose: "investment",
            currentCents: 400_000,
            targetCents: 500_000,
          }),
        ],
      }),
    );
    expect(tooSmallHeadroom.items[0]).toMatchObject({
      kind: "etf",
      amountCents: 500_000,
      target: { type: "none" },
    });
  });

  it("handles loan prepayment rights, caps, unknown cap, and fixed interest ending soon", () => {
    // cap = 0
    const noRight = recommendUse(
      500_000,
      makeState({
        monthlyExpensesCents: 0,
        loans: [makeLoan({ specialRepaymentMaxYearlyCents: 0 })],
      }),
    );
    expect(noRight.notes).toContainEqual({
      code: "LOAN_NO_PREPAYMENT_RIGHT",
      loanId: "loan-1",
    });
    expect(noRight.items[0]?.kind).toBe("etf");

    // cap 5000 EUR, 2000 EUR used, rest 8000 EUR -> 3000 prepayment + 5000 overflow
    const capped = recommendUse(
      800_000,
      makeState({
        monthlyExpensesCents: 0,
        loans: [
          makeLoan({
            interestRateBps: 550,
            specialRepaymentMaxYearlyCents: 500_000,
          }),
        ],
      }),
      {
        specialRepaymentUsedThisYearCentsByLoanId: { "loan-1": 200_000 },
      },
    );
    expect(capped.items[0]).toMatchObject({
      kind: "loan_prepayment",
      amountCents: 300_000,
      target: { type: "loan", loanId: "loan-1" },
    });
    expect(capped.items[0]?.reasons).toContainEqual({
      code: "PREPAYMENT_CAP_REACHED",
      capCents: 500_000,
      usedCents: 200_000,
      overflowCents: 500_000,
    });
    expect(capped.items[1]).toMatchObject({
      kind: "etf",
      amountCents: 500_000,
    });

    // cap fully used
    const fullCap = recommendUse(
      200_000,
      makeState({
        monthlyExpensesCents: 0,
        loans: [
          makeLoan({
            interestRateBps: 550,
            specialRepaymentMaxYearlyCents: 500_000,
          }),
        ],
      }),
      {
        specialRepaymentUsedThisYearCentsByLoanId: { "loan-1": 500_000 },
      },
    );
    expect(fullCap.items.every((i) => i.kind !== "loan_prepayment")).toBe(true);

    // cap = null -> PREPAYMENT_CAP_UNKNOWN
    const unknownCap = recommendUse(
      200_000,
      makeState({
        monthlyExpensesCents: 0,
        loans: [
          makeLoan({
            interestRateBps: 550,
            specialRepaymentMaxYearlyCents: null,
          }),
        ],
      }),
    );
    expect(unknownCap.items[0]?.reasons).toContainEqual({
      code: "PREPAYMENT_CAP_UNKNOWN",
    });

    // Fixed interest ends in 8 months (< 12) -> loan_reserve
    const endingSoon = recommendUse(
      300_000,
      makeState({
        asOfDate: "2026-11-19",
        monthlyExpensesCents: 0,
        pots: [
          makePot({
            id: "pot-res",
            purpose: "goal",
            linkedContractId: "loan-1",
          }),
        ],
        loans: [
          makeLoan({
            fixedInterestUntil: "2027-07-19", // 8 months
            futureLoanInterestRateBps: 550,
            specialRepaymentMaxYearlyCents: 0, // ignored for reserve
          }),
        ],
      }),
    );
    expect(endingSoon.items[0]).toMatchObject({
      kind: "loan_reserve",
      amountCents: 300_000,
      target: { type: "pot", potId: "pot-res" },
    });
    expect(endingSoon.items[0]?.reasons).toContainEqual({
      code: "FIXED_INTEREST_ENDS_SOON",
      fixedInterestUntil: "2027-07-19",
      monthsUntil: 8,
      futureRateBps: 550,
    });

    // Boundary: exactly 12 months -> normal prepayment
    const exact12 = recommendUse(
      300_000,
      makeState({
        asOfDate: "2026-11-19",
        monthlyExpensesCents: 0,
        loans: [
          makeLoan({
            interestRateBps: 550,
            fixedInterestUntil: "2027-11-19",
          }),
        ],
      }),
    );
    expect(exact12.items[0]?.kind).toBe("loan_prepayment");

    // Past fixedInterestUntil -> HORIZON_ESTIMATED
    const pastFixed = recommendUse(
      300_000,
      makeState({
        asOfDate: "2026-11-19",
        monthlyExpensesCents: 0,
        loans: [
          makeLoan({
            interestRateBps: 550,
            fixedInterestUntil: "2025-01-01",
          }),
        ],
      }),
    );
    expect(pastFixed.items[0]?.reasons).toContainEqual({
      code: "HORIZON_ESTIMATED",
      horizonMonths: 120,
    });
  });

  it("compares against break-even + safety margin and sorts multiple loans", () => {
    const lowLoan = makeLoan({
      id: "loan-low",
      interestRateBps: 100,
      specialRepaymentMaxYearlyCents: 1_000_000,
    });
    const be = findBreakEvenReturnBps({
      loan: lowLoan,
      startDate: "2026-11-19",
      horizonEndDate: "2032-11-01",
      oneTimeAmountCents: 500_000,
      monthlyAmountCents: 0,
      saverAllowanceCents: 100_000,
      churchTaxBps: 0,
    });
    expect(be.kind).toBe("bps");
    if (be.kind !== "bps") return;

    const etfWins = recommendUse(
      500_000,
      makeState({
        monthlyExpensesCents: 0,
        loans: [lowLoan],
      }),
      { etfAnnualReturnBps: 600, safetyMarginBps: 100 },
    );
    expect(etfWins.items[0]?.kind).toBe("etf");
    expect(etfWins.items[0]?.reasons[0]).toMatchObject({
      code: "ETF_BEATS_PREPAYMENT",
      breakEvenBps: be.bps,
    });

    // Boundary: expected === breakEven + safetyMargin -> ETF wins
    const boundaryEtf = recommendUse(
      500_000,
      makeState({
        monthlyExpensesCents: 0,
        loans: [lowLoan],
      }),
      { etfAnnualReturnBps: be.bps + 100, safetyMarginBps: 100 },
    );
    expect(boundaryEtf.items[0]?.kind).toBe("etf");

    // safetyMarginBps = 0 shifts boundary: expected = be.bps - 1 -> prepayment
    const shifted = recommendUse(
      500_000,
      makeState({
        monthlyExpensesCents: 0,
        loans: [lowLoan],
      }),
      { etfAnnualReturnBps: Math.max(0, be.bps - 1), safetyMarginBps: 0 },
    );
    if (be.bps > 0) {
      expect(shifted.items[0]?.kind).toBe("loan_prepayment");
    }

    // Multiple loans: highest interest first, tie-break by id, overflow to second
    const multi = recommendUse(
      700_000,
      makeState({
        monthlyExpensesCents: 0,
        loans: [
          makeLoan({
            id: "loan-b",
            interestRateBps: 500,
            specialRepaymentMaxYearlyCents: 400_000,
          }),
          makeLoan({
            id: "loan-a",
            interestRateBps: 500,
            specialRepaymentMaxYearlyCents: 400_000,
          }),
          makeLoan({
            id: "loan-c",
            interestRateBps: 600,
            specialRepaymentMaxYearlyCents: 200_000,
          }),
        ],
      }),
    );
    expect(multi.loanOrder).toEqual(["loan-c", "loan-a", "loan-b"]);
    expect(multi.items.map((i) => i.target)).toEqual([
      { type: "loan", loanId: "loan-c" },
      { type: "loan", loanId: "loan-a" },
      { type: "loan", loanId: "loan-b" },
    ]);
    expect(multi.items.map((i) => i.amountCents)).toEqual([
      200_000, 400_000, 100_000,
    ]);
  });

  it("keeps liquid when expected ETF return <= 0 and no loan is prepaid", () => {
    const res = recommendUse(
      300_000,
      makeState({ monthlyExpensesCents: 0 }),
      { etfAnnualReturnBps: 0 },
    );
    expect(res.items[0]).toMatchObject({
      kind: "keep_liquid",
      amountCents: 300_000,
      reasons: [{ code: "KEEP_LIQUID_NON_POSITIVE_RETURN", expectedReturnBps: 0 }],
    });
  });

  it("satisfies sum and uniqueness invariants across combinations and is deterministic", () => {
    const amounts = [1, 99, 1_000_001, 1_234_567];
    const pots: RecommendationPot[] = [
      makePot({
        id: "pot-1",
        priority: 1,
        purpose: "emergency_fund",
        currentCents: 10_000,
        targetCents: 50_000,
      }),
      makePot({
        id: "pot-2",
        priority: 2,
        purpose: "goal",
        currentCents: 0,
        targetCents: 200_000,
        targetDate: "2027-06-01",
      }),
      makePot({
        id: "pot-3",
        priority: 3,
        purpose: "investment",
        currentCents: 0,
        targetCents: null,
      }),
    ];
    const loans: RecommendationLoan[] = [
      makeLoan({
        id: "loan-1",
        interestRateBps: 550,
        specialRepaymentMaxYearlyCents: 300_000,
      }),
      makeLoan({
        id: "loan-2",
        interestRateBps: 150,
        specialRepaymentMaxYearlyCents: 300_000,
      }),
    ];

    for (const amount of amounts) {
      const res = recommendUse(amount, makeState({ pots, loans }));
      const sum = res.items.reduce((acc, i) => acc + i.amountCents, 0);
      expect(sum).toBe(amount);
      const keys = new Set(
        res.items.map((i) => `${i.kind}|${JSON.stringify(i.target)}`),
      );
      expect(keys.size).toBe(res.items.length);
      for (const item of res.items) {
        expect(Number.isSafeInteger(item.amountCents)).toBe(true);
        expect(item.amountCents).toBeGreaterThan(0);
      }
    }

    const r1 = recommendUse(1_000_000, makeState({ pots, loans }));
    const r2 = recommendUse(
      1_000_000,
      makeState({ pots: [...pots].reverse(), loans: [...loans].reverse() }),
    );
    expect(r1).toEqual(r2);
  });
});

describe("recommendMonthlySavings", () => {
  it("handles non-positive surplus", () => {
    expect(
      recommendMonthlySavings(makeState({ monthlySurplusCents: 0 })).notes,
    ).toContainEqual({ code: "NO_SURPLUS", surplusCents: 0 });
    expect(
      recommendMonthlySavings(makeState({ monthlySurplusCents: -30_000 })).items,
    ).toEqual([]);
  });

  it("computes 10% floor buffer, emergency fund monthly, pot deadlines, and monthly loan caps", () => {
    const res = recommendMonthlySavings(
      makeState({
        asOfDate: "2026-12-01", // December -> 1 remaining month in year
        monthlySurplusCents: 123_457,
        monthlyExpensesCents: 100_000, // target 300_000 -> 25_000/month
        pots: [
          makePot({
            id: "pot-ef",
            purpose: "emergency_fund",
            currentCents: 0,
          }),
          makePot({
            id: "pot-due",
            purpose: "goal",
            currentCents: 0,
            targetCents: 50_000,
            targetDate: "2026-12-15", // restMonths = 0 -> POT_DUE_ONE_TIME
          }),
        ],
        loans: [
          makeLoan({
            id: "loan-1",
            interestRateBps: 550,
            specialRepaymentMaxYearlyCents: 50_000,
          }),
        ],
      }),
    );

    expect(res.items.reduce((a, b) => a + b.amountCents, 0)).toBe(123_457);
    expect(res.items[0]).toMatchObject({
      kind: "keep_liquid",
      amountCents: 12_345, // floor(10%)
    });
    expect(res.items[1]).toMatchObject({
      kind: "emergency_fund",
      amountCents: 25_000,
    });
    expect(res.notes).toContainEqual({
      code: "POT_DUE_ONE_TIME",
      potId: "pot-due",
      shortfallCents: 50_000,
    });
    expect(res.items[2]).toMatchObject({
      kind: "loan_prepayment",
      amountCents: 50_000,
    });
    expect(res.items[3]).toMatchObject({
      kind: "etf",
      amountCents: 123_457 - 12_345 - 25_000 - 50_000,
    });
  });

  it("handles buffer = 0 and insufficient rest for pot deadline", () => {
    const res = recommendMonthlySavings(
      makeState({
        asOfDate: "2026-11-01",
        monthlySurplusCents: 10_000,
        monthlyExpensesCents: 0,
        pots: [
          makePot({
            id: "pot-goal",
            purpose: "goal",
            currentCents: 0,
            targetCents: 100_000,
            targetDate: "2027-02-01", // 3 months -> 33_334/month
          }),
        ],
      }),
      { savingsBufferBps: 0 },
    );
    expect(res.items).toHaveLength(1);
    expect(res.items[0]).toMatchObject({
      kind: "pot_deadline",
      amountCents: 10_000,
    });
    expect(res.items[0]?.reasons).toContainEqual({
      code: "POT_MONTHLY_INSUFFICIENT",
      requiredMonthlyCents: 33_334,
      allocatedCents: 10_000,
      targetMonth: "2027-02",
    });
  });

  it("never double-fills an emergency_fund pot with a targetDate in either mode", () => {
    const state = makeState({
      asOfDate: "2026-11-19",
      monthlySurplusCents: 200_000,
      monthlyExpensesCents: 250_000,
      pots: [
        makePot({
          id: "pot-ef-dated",
          purpose: "emergency_fund",
          currentCents: 0,
          targetCents: 750_000,
          targetDate: "2027-06-01",
        }),
      ],
    });

    const oneTime = recommendUse(2_000_000, state);
    const potSumOneTime = oneTime.items
      .filter((i) => i.target.type === "pot" && i.target.potId === "pot-ef-dated")
      .reduce((acc, i) => acc + i.amountCents, 0);
    expect(potSumOneTime).toBeLessThanOrEqual(750_000);
    expect(potSumOneTime).toBe(750_000);

    const monthly = recommendMonthlySavings(state, { savingsBufferBps: 0 });
    const potSumMonthly = monthly.items
      .filter((i) => i.target.type === "pot" && i.target.potId === "pot-ef-dated")
      .reduce((acc, i) => acc + i.amountCents, 0);
    expect(potSumMonthly).toBeLessThanOrEqual(750_000);
    expect(
      monthly.items.filter(
        (i) => i.target.type === "pot" && i.target.potId === "pot-ef-dated",
      ),
    ).toHaveLength(1);
  });

  it("does not exceed pot target for loan_reserve or rule-based emergency_fund", () => {
    const reserveState = makeState({
      asOfDate: "2026-11-19",
      monthlyExpensesCents: 0,
      pots: [
        makePot({
          id: "pot-res-small",
          purpose: "goal",
          currentCents: 100_000,
          targetCents: 200_000,
          linkedContractId: "loan-1",
        }),
      ],
      loans: [
        makeLoan({
          id: "loan-1",
          fixedInterestUntil: "2027-07-19",
          futureLoanInterestRateBps: 550,
          specialRepaymentMaxYearlyCents: 0,
        }),
      ],
    });
    const reserveRes = recommendUse(500_000, reserveState);
    expect(reserveRes.items[0]).toMatchObject({
      kind: "loan_reserve",
      amountCents: 500_000,
      target: { type: "none" },
    });

    const ruleEfState = makeState({
      asOfDate: "2026-11-19",
      monthlyExpensesCents: 250_000, // rule target = 750_000
      pots: [
        makePot({
          id: "pot-ef-1",
          priority: 1,
          purpose: "emergency_fund",
          currentCents: 0,
          targetCents: 200_000, // smaller than rule gap
        }),
        makePot({
          id: "pot-ef-2",
          priority: 2,
          purpose: "emergency_fund",
          currentCents: 0,
          targetCents: null,
        }),
      ],
    });
    const ruleEfRes = recommendUse(750_000, ruleEfState);
    expect(ruleEfRes.items[0]).toMatchObject({
      kind: "emergency_fund",
      amountCents: 750_000,
      target: { type: "pot", potId: "pot-ef-2" },
    });
  });
});

function makeCorridor(overrides: Partial<RateCorridor> = {}): RateCorridor {
  return {
    status: "allowed",
    currentMonthlyCents: 100_000,
    minMonthlyCents: 70_000,
    maxMonthlyCents: 150_000,
    sliderMinMonthlyCents: 70_000,
    monthlyInterestCents: 35_000,
    remainingChanges: 2,
    latestChangeDate: "2036-01-01",
    minRepaymentBps: 100,
    maxRepaymentBps: 500,
    flags: {
      corridorAssumed: false,
      approximatedBase: false,
      currentOutsideCorridor: false,
      minBelowInterest: false,
      perYearUsageUntracked: false,
      exhausted: false,
      corridorEmpty: false,
    },
    ...overrides,
  };
}

describe("loan rate increase & special repayment rules (Slice 24)", () => {
  it("creates loan_rate_increase only when special allowance is insufficient, rounds down to 10€, sums exactly to surplus", () => {
    // Special cap covers everything -> no loan_rate_increase
    const enoughSpecial = recommendMonthlySavings(
      makeState({
        asOfDate: "2026-01-15",
        monthlyExpensesCents: 0,
        monthlySurplusCents: 100_000,
        loans: [
          makeLoan({
            id: "loan-1",
            interestRateBps: 550,
            monthlyRateCents: 100_000,
            specialRepaymentMaxYearlyCents: 2_000_000,
            rateCorridor: makeCorridor(),
          }),
        ],
      }),
      { savingsBufferBps: 0 },
    );
    expect(enoughSpecial.items.some((i) => i.kind === "loan_rate_increase")).toBe(
      false,
    );

    // Special cap too small: surplus 100_500 (1005 €), annual cap 240_000 / 12 = 20_000/month
    // Remaining 80_500; 50% share cap of 100_500 = 50_250 -> rounded down to 10 € = 50_000; rest 30_500 -> ETF
    const split = recommendMonthlySavings(
      makeState({
        asOfDate: "2026-01-15",
        monthlyExpensesCents: 0,
        monthlySurplusCents: 100_500,
        loans: [
          makeLoan({
            id: "loan-1",
            interestRateBps: 550,
            monthlyRateCents: 100_000,
            specialRepaymentMaxYearlyCents: 240_000,
            rateCorridor: makeCorridor({ maxMonthlyCents: 200_000 }),
          }),
        ],
      }),
      { savingsBufferBps: 0 },
    );
    const rateItem = split.items.find((i) => i.kind === "loan_rate_increase");
    expect(rateItem).toBeDefined();
    expect(rateItem?.amountCents).toBe(50_000);
    expect(rateItem?.currentMonthlyRateCents).toBe(100_000);
    expect(rateItem?.newMonthlyRateCents).toBe(150_000);
    expect(rateItem?.reasons.some((r) => r.code === "RATE_INCREASE_BEATS_ETF")).toBe(
      true,
    );
    expect(rateItem?.reasons.some((r) => r.code === "RATE_CHANGE_SHARE_LIMIT")).toBe(
      true,
    );
    const total = split.items.reduce((acc, i) => acc + i.amountCents, 0);
    expect(total).toBe(100_500);
  });

  it("enforces corridor max limit, exhausted changes, unknown count, unknown right, and assumed corridor", () => {
    // Corridor max limits to +20_000
    const corridorLimited = recommendMonthlySavings(
      makeState({
        asOfDate: "2026-01-15",
        monthlyExpensesCents: 0,
        monthlySurplusCents: 100_000,
        loans: [
          makeLoan({
            interestRateBps: 550,
            monthlyRateCents: 100_000,
            specialRepaymentMaxYearlyCents: 0,
            rateCorridor: makeCorridor({ maxMonthlyCents: 120_000 }),
          }),
        ],
      }),
      { savingsBufferBps: 0 },
    );
    const rcItem = corridorLimited.items.find(
      (i) => i.kind === "loan_rate_increase",
    );
    expect(rcItem?.amountCents).toBe(20_000);
    expect(
      rcItem?.reasons.some((r) => r.code === "RATE_CHANGE_CORRIDOR_LIMIT"),
    ).toBe(true);

    // Exhausted -> no item
    const exhausted = recommendMonthlySavings(
      makeState({
        asOfDate: "2026-01-15",
        monthlyExpensesCents: 0,
        monthlySurplusCents: 100_000,
        loans: [
          makeLoan({
            interestRateBps: 550,
            monthlyRateCents: 100_000,
            specialRepaymentMaxYearlyCents: 0,
            rateCorridor: makeCorridor({
              remainingChanges: 0,
              flags: { ...makeCorridor().flags, exhausted: true },
            }),
          }),
        ],
      }),
      { savingsBufferBps: 0 },
    );
    expect(exhausted.items.some((i) => i.kind === "loan_rate_increase")).toBe(
      false,
    );

    // Unknown count (remainingChanges = null) -> item + RATE_CHANGE_COUNT_UNKNOWN
    const unknownCount = recommendMonthlySavings(
      makeState({
        asOfDate: "2026-01-15",
        monthlyExpensesCents: 0,
        monthlySurplusCents: 100_000,
        loans: [
          makeLoan({
            interestRateBps: 550,
            monthlyRateCents: 100_000,
            specialRepaymentMaxYearlyCents: 0,
            rateCorridor: makeCorridor({ remainingChanges: null }),
          }),
        ],
      }),
      { savingsBufferBps: 0 },
    );
    const ucItem = unknownCount.items.find((i) => i.kind === "loan_rate_increase");
    expect(ucItem).toBeDefined();
    expect(
      ucItem?.reasons.some((r) => r.code === "RATE_CHANGE_COUNT_UNKNOWN"),
    ).toBe(true);

    // Unknown right -> no item + RATE_CHANGE_RIGHT_UNKNOWN
    const unknownRight = recommendMonthlySavings(
      makeState({
        asOfDate: "2026-01-15",
        monthlyExpensesCents: 0,
        monthlySurplusCents: 100_000,
        loans: [
          makeLoan({
            interestRateBps: 550,
            monthlyRateCents: 100_000,
            specialRepaymentMaxYearlyCents: 0,
            rateCorridor: makeCorridor({
              status: "unknown",
              flags: { ...makeCorridor().flags, corridorAssumed: true },
            }),
          }),
        ],
      }),
      { savingsBufferBps: 0 },
    );
    expect(unknownRight.items.some((i) => i.kind === "loan_rate_increase")).toBe(
      false,
    );
    expect(unknownRight.notes).toContainEqual({
      code: "RATE_CHANGE_RIGHT_UNKNOWN",
      loanId: "loan-1",
    });

    // Assumed corridor on allowed right -> no item
    const assumed = recommendMonthlySavings(
      makeState({
        asOfDate: "2026-01-15",
        monthlyExpensesCents: 0,
        monthlySurplusCents: 100_000,
        loans: [
          makeLoan({
            interestRateBps: 550,
            monthlyRateCents: 100_000,
            specialRepaymentMaxYearlyCents: 0,
            rateCorridor: makeCorridor({
              flags: { ...makeCorridor().flags, corridorAssumed: true },
            }),
          }),
        ],
      }),
      { savingsBufferBps: 0 },
    );
    expect(assumed.items.some((i) => i.kind === "loan_rate_increase")).toBe(
      false,
    );
  });

  it("skips rate increase when fixed interest ends in 11 months (not 12), ETF wins, or emergency fund has gap; emits RATE_DECREASE_POSSIBLE", () => {
    // 11 months -> RATE_CHANGE_SKIPPED_FIXED_END_SOON
    const ends11 = recommendMonthlySavings(
      makeState({
        asOfDate: "2026-01-15",
        monthlyExpensesCents: 0,
        monthlySurplusCents: 100_000,
        loans: [
          makeLoan({
            interestRateBps: 550,
            fixedInterestUntil: "2026-12-15", // 11 months
            rateCorridor: makeCorridor(),
          }),
        ],
      }),
      { savingsBufferBps: 0 },
    );
    expect(ends11.items.some((i) => i.kind === "loan_rate_increase")).toBe(false);
    expect(
      ends11.notes.some((n) => n.code === "RATE_CHANGE_SKIPPED_FIXED_END_SOON"),
    ).toBe(true);

    // Exactly 12 months -> allowed
    const ends12 = recommendMonthlySavings(
      makeState({
        asOfDate: "2026-01-15",
        monthlyExpensesCents: 0,
        monthlySurplusCents: 100_000,
        loans: [
          makeLoan({
            interestRateBps: 550,
            specialRepaymentMaxYearlyCents: 0,
            fixedInterestUntil: "2027-01-15", // 12 months
            rateCorridor: makeCorridor(),
          }),
        ],
      }),
      { savingsBufferBps: 0 },
    );
    expect(ends12.items.some((i) => i.kind === "loan_rate_increase")).toBe(true);
    expect(
      ends12.notes.some((n) => n.code === "RATE_CHANGE_SKIPPED_FIXED_END_SOON"),
    ).toBe(false);

    // ETF wins -> no rate increase
    const etfWins = recommendMonthlySavings(
      makeState({
        asOfDate: "2026-01-15",
        monthlyExpensesCents: 0,
        monthlySurplusCents: 100_000,
        loans: [
          makeLoan({
            interestRateBps: 100,
            specialRepaymentMaxYearlyCents: 0,
            rateCorridor: makeCorridor(),
          }),
        ],
      }),
      { savingsBufferBps: 0, etfAnnualReturnBps: 600 },
    );
    expect(etfWins.items.some((i) => i.kind === "loan_rate_increase")).toBe(false);

    // Emergency fund gap -> no rate increase + RATE_DECREASE_POSSIBLE
    const efGap = recommendMonthlySavings(
      makeState({
        asOfDate: "2026-01-15",
        monthlyExpensesCents: 200_000,
        monthlySurplusCents: 100_000,
        pots: [
          makePot({
            id: "pot-ef",
            purpose: "emergency_fund",
            currentCents: 100_000,
            targetCents: 600_000,
          }),
        ],
        loans: [
          makeLoan({
            interestRateBps: 550,
            monthlyRateCents: 100_000,
            specialRepaymentMaxYearlyCents: 0,
            rateCorridor: makeCorridor({ minMonthlyCents: 70_000 }),
          }),
        ],
      }),
      { savingsBufferBps: 0 },
    );
    expect(efGap.items.some((i) => i.kind === "loan_rate_increase")).toBe(false);
    expect(efGap.notes).toContainEqual({
      code: "RATE_DECREASE_POSSIBLE",
      loanId: "loan-1",
      currentMonthlyRateCents: 100_000,
      minMonthlyCents: 70_000,
      reliefCents: 30_000,
    });

    // NO_SURPLUS -> RATE_DECREASE_POSSIBLE
    const noSurplus = recommendMonthlySavings(
      makeState({
        asOfDate: "2026-01-15",
        monthlySurplusCents: 0,
        loans: [
          makeLoan({
            monthlyRateCents: 100_000,
            rateCorridor: makeCorridor({ minMonthlyCents: 75_000 }),
          }),
        ],
      }),
    );
    expect(noSurplus.notes).toContainEqual({
      code: "RATE_DECREASE_POSSIBLE",
      loanId: "loan-1",
      currentMonthlyRateCents: 100_000,
      minMonthlyCents: 75_000,
      reliefCents: 25_000,
    });
  });

  it("handles multiple loans sequentially, one-time mode RATE_CHANGE_ALTERNATIVE, persisted usedCents vs override, and fingerprint changes", () => {
    // Two loans: loan-1 takes corridor max +20k, loan-2 takes remaining +30k up to 50% share cap (50k)
    const multi = recommendMonthlySavings(
      makeState({
        asOfDate: "2026-01-15",
        monthlyExpensesCents: 0,
        monthlySurplusCents: 100_000,
        loans: [
          makeLoan({
            id: "loan-1",
            interestRateBps: 600,
            monthlyRateCents: 100_000,
            specialRepaymentMaxYearlyCents: 0,
            rateCorridor: makeCorridor({ maxMonthlyCents: 120_000 }),
          }),
          makeLoan({
            id: "loan-2",
            interestRateBps: 550,
            monthlyRateCents: 100_000,
            specialRepaymentMaxYearlyCents: 0,
            rateCorridor: makeCorridor({ maxMonthlyCents: 200_000 }),
          }),
        ],
      }),
      { savingsBufferBps: 0 },
    );
    const rateItems = multi.items.filter((i) => i.kind === "loan_rate_increase");
    expect(rateItems).toHaveLength(2);
    expect(rateItems[0]?.amountCents).toBe(20_000);
    expect(rateItems[1]?.amountCents).toBe(30_000);

    // One-time mode: never loan_rate_increase, emits RATE_CHANGE_ALTERNATIVE when capped
    const oneTime = recommendUse(
      1_000_000,
      makeState({
        asOfDate: "2026-01-15",
        monthlyExpensesCents: 0,
        loans: [
          makeLoan({
            id: "loan-1",
            interestRateBps: 550,
            monthlyRateCents: 100_000,
            specialRepaymentMaxYearlyCents: 200_000,
            rateCorridor: makeCorridor({ maxMonthlyCents: 150_000 }),
          }),
        ],
      }),
    );
    expect(oneTime.items.some((i) => i.kind === "loan_rate_increase")).toBe(false);
    expect(oneTime.notes).toContainEqual({
      code: "RATE_CHANGE_ALTERNATIVE",
      loanId: "loan-1",
      remainingChanges: 2,
      maxMonthlyCents: 150_000,
    });

    // Persisted usedCents reduces room, UI override takes precedence, missing originalPrincipal emits note
    const withPersisted = recommendUse(
      500_000,
      makeState({
        asOfDate: "2026-01-15",
        monthlyExpensesCents: 0,
        loans: [
          makeLoan({
            id: "loan-1",
            interestRateBps: 550,
            specialRepaymentMaxYearlyCents: 300_000,
            specialRepaymentUsedThisYearCents: 200_000,
          }),
        ],
      }),
    );
    expect(withPersisted.items[0]?.amountCents).toBe(100_000);

    const withOverride = recommendUse(
      500_000,
      makeState({
        asOfDate: "2026-01-15",
        monthlyExpensesCents: 0,
        loans: [
          makeLoan({
            id: "loan-1",
            interestRateBps: 550,
            specialRepaymentMaxYearlyCents: 300_000,
            specialRepaymentUsedThisYearCents: 200_000,
          }),
        ],
      }),
      { specialRepaymentUsedThisYearCentsByLoanId: { "loan-1": 50_000 } },
    );
    expect(withOverride.items[0]?.amountCents).toBe(250_000);

    const missingOrig = recommendUse(
      300_000,
      makeState({
        asOfDate: "2026-01-15",
        monthlyExpensesCents: 0,
        loans: [
          makeLoan({
            id: "loan-1",
            interestRateBps: 550,
            specialRepaymentMaxYearlyCents: null,
            specialRepaymentRule: {
              kind: "allowed_unknown_amount",
              missingOriginalPrincipal: true,
            },
          }),
        ],
      }),
    );
    expect(missingOrig.notes).toContainEqual({
      code: "SPECIAL_REPAYMENT_AMOUNT_UNKNOWN",
      loanId: "loan-1",
      missingOriginalPrincipal: true,
    });

    // Fingerprint changes when corridor or remainingChanges changes
    const fp1 = computeRecommendationFingerprint(
      recommendMonthlySavings(
        makeState({
          asOfDate: "2026-01-15",
          monthlyExpensesCents: 0,
          monthlySurplusCents: 100_000,
          loans: [
            makeLoan({
              interestRateBps: 100,
              rateCorridor: makeCorridor({ remainingChanges: 2 }),
            }),
          ],
        }),
      ),
    );
    const fp2 = computeRecommendationFingerprint(
      recommendMonthlySavings(
        makeState({
          asOfDate: "2026-01-15",
          monthlyExpensesCents: 0,
          monthlySurplusCents: 100_000,
          loans: [
            makeLoan({
              interestRateBps: 100,
              rateCorridor: makeCorridor({ remainingChanges: 1 }),
            }),
          ],
        }),
      ),
    );
    expect(fp1).not.toBe(fp2);
  });

  it("does not throw or emit loan_rate_increase when corridorEmpty is true after calibration", () => {
    const res = recommendMonthlySavings(
      makeState({
        asOfDate: "2026-01-15",
        monthlyExpensesCents: 0,
        monthlySurplusCents: 200_000,
        loans: [
          makeLoan({
            interestRateBps: 550,
            specialRepaymentMaxYearlyCents: 0,
            rateCorridor: makeCorridor({
              minMonthlyCents: 100_000,
              maxMonthlyCents: 100_000,
              sliderMinMonthlyCents: 100_000,
              flags: {
                corridorAssumed: false,
                approximatedBase: true,
                currentOutsideCorridor: false,
                minBelowInterest: false,
                perYearUsageUntracked: false,
                exhausted: false,
                corridorEmpty: true,
              },
            }),
          }),
        ],
      }),
      { savingsBufferBps: 0 },
    );
    expect(res.items.some((i) => i.kind === "loan_rate_increase")).toBe(false);
  });
});
