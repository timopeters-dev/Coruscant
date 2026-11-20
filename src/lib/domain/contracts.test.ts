import { describe, expect, it } from "vitest";
import {
  applyCappedSpecialRepayment,
  calculateMonthlyInterestCents,
  type DomainContract,
  extractContractMilestones,
  getCalibrationAge,
  projectContractBalance,
  stepContractMonth,
  validateContract,
} from "./contracts";

function makeLoan(overrides: Partial<DomainContract> = {}): DomainContract {
  return {
    id: "loan-1",
    name: "Hauskredit Musterbank",
    category: "loan",
    status: "active",
    currentBalanceCents: 10_000_000, // 100.000,00 €
    balanceAsOfDate: "2026-01-01",
    monthlyRateCents: 100_000, // 1.000,00 €
    interestRateBps: 360, // 3,60 % -> 0,30 %/Monat
    repaymentType: "annuity",
    ...overrides,
  };
}

describe("calculateMonthlyInterestCents", () => {
  it("calculates exact monthly interest using BigInt half-up division", () => {
    // 100.000,00 € * 3,60 % / 12 = 300,00 € = 30.000 Cent
    expect(calculateMonthlyInterestCents(10_000_000, 360)).toBe(30_000);
    // 0-balance or 0-bps
    expect(calculateMonthlyInterestCents(0, 360)).toBe(0);
    expect(calculateMonthlyInterestCents(10_000_000, 0)).toBe(0);
    // Half-up boundary: 100_000 * 6 / 120_000 = 5; 100_000 * 7 / 120_000 = 5.83 -> 6
    // Exact half: 60_000 / 120_000 = 0.5 -> 1
    expect(calculateMonthlyInterestCents(60_000, 1)).toBe(1);
    expect(calculateMonthlyInterestCents(59_999, 1)).toBe(0);
  });

  it("rejects negative or non-integer inputs", () => {
    expect(() => calculateMonthlyInterestCents(-1, 350)).toThrow(RangeError);
    expect(() => calculateMonthlyInterestCents(1000, -1)).toThrow(RangeError);
    expect(() => calculateMonthlyInterestCents(10.5, 350)).toThrow(RangeError);
  });
});

describe("projectContractBalance", () => {
  it("projects an annuity loan over 6 months without float drift", () => {
    const loan = makeLoan();
    const res = projectContractBalance(loan, "2026-07-01");

    expect(res.monthsElapsed).toBe(6);
    expect(res.isProjected).toBe(true);
    expect(res.reachedZeroAtMonth).toBeNull();
    // Month 1: 30000 int, 70000 prin -> 9930000
    // Total payments = 6 * 100_000 = 600_000
    expect(res.totalContributionsCents).toBe(600_000);
    expect(res.totalPrincipalPaidCents + res.totalInterestAccruedCents).toBe(
      600_000,
    );
    expect(res.projectedBalanceCents).toBe(
      10_000_000 - res.totalPrincipalPaidCents,
    );
    expect(res.projectedBalanceCents).toBe(9_576_837);
  });

  it("projects an installment loan with constant principal and decreasing interest", () => {
    const loan = makeLoan({
      repaymentType: "installment",
      currentBalanceCents: 1_200_000,
      monthlyRateCents: 100_000,
      interestRateBps: 600, // 0.5% / month
    });

    const res = projectContractBalance(loan, "2026-04-01");
    expect(res.monthsElapsed).toBe(3);
    expect(res.totalPrincipalPaidCents).toBe(300_000);
    expect(res.projectedBalanceCents).toBe(900_000);
    // Interests: 6000 + 5500 + 5000 = 16500
    expect(res.totalInterestAccruedCents).toBe(16_500);
    expect(res.totalContributionsCents).toBe(316_500);
  });

  it("keeps lump_sum loan balance unchanged", () => {
    const loan = makeLoan({
      name: "Privatdarlehen Familie",
      repaymentType: "lump_sum",
      currentBalanceCents: 1_500_000,
      monthlyRateCents: 0,
      interestRateBps: 0,
    });

    const res = projectContractBalance(loan, "2026-10-01");
    expect(res.monthsElapsed).toBe(9);
    expect(res.isProjected).toBe(false);
    expect(res.projectedBalanceCents).toBe(1_500_000);
    expect(res.totalContributionsCents).toBe(0);
  });

  it("projects a savings_contract (Bausparer) and evaluates allocation threshold", () => {
    const bausparer: DomainContract = {
      id: "sav-1",
      name: "Bausparvertrag Musterkasse",
      category: "savings_contract",
      status: "active",
      currentBalanceCents: 1_900_000,
      balanceAsOfDate: "2026-01-01",
      monthlyRateCents: 50_000,
      interestRateBps: 120, // 1.20 % -> 0.1% / month
      targetSumCents: 5_000_000,
      allocationThresholdPercent: 40, // 2.000.000 Cent
    };

    const res1 = projectContractBalance(bausparer, "2026-02-01");
    expect(res1.projectedBalanceCents).toBe(1_951_900);
    expect(res1.isAllocationThresholdReached).toBe(false);

    const res2 = projectContractBalance(bausparer, "2026-03-01");
    expect(res2.projectedBalanceCents).toBe(2_003_852);
    expect(res2.isAllocationThresholdReached).toBe(true);
    expect(res2.targetProgressBps).toBe(4007);
  });

  it("projects a savings_contract starting negative (Abschlussgebühr) with 0 % target progress", () => {
    const bausparer: DomainContract = {
      id: "sav-neg",
      name: "Bausparvertrag Musterkasse",
      category: "savings_contract",
      status: "active",
      currentBalanceCents: -150_000, // −1.500 € Abschlussgebühr
      balanceAsOfDate: "2026-01-01",
      monthlyRateCents: 50_000,
      interestRateBps: 120,
      targetSumCents: 15_000_000,
      allocationThresholdPercent: 40,
    };

    const start = projectContractBalance(bausparer, "2026-01-01");
    expect(start.projectedBalanceCents).toBe(-150_000);
    expect(start.targetProgressBps).toBe(0);
    expect(start.isAllocationThresholdReached).toBe(false);

    // Monate 1–3 gleichen aus (−100.000, −50.000, 0), Monat 4 baut Guthaben auf.
    const afterThree = projectContractBalance(bausparer, "2026-04-01");
    expect(afterThree.projectedBalanceCents).toBe(0);
    expect(afterThree.totalInterestAccruedCents).toBe(0);
    expect(afterThree.targetProgressBps).toBe(0);

    const afterFour = projectContractBalance(bausparer, "2026-05-01");
    expect(afterFour.projectedBalanceCents).toBe(50_000);
    expect(afterFour.totalContributionsCents).toBe(200_000);
  });

  it("rejects a negative balance for loans but not for savings contracts", () => {
    expect(() =>
      validateContract(makeLoan({ currentBalanceCents: -1 })),
    ).toThrow(RangeError);
    expect(() =>
      validateContract({
        id: "sav-neg",
        name: "Bausparvertrag Musterkasse",
        category: "savings_contract",
        status: "active",
        currentBalanceCents: -1,
        balanceAsOfDate: "2026-01-01",
        monthlyRateCents: 0,
        interestRateBps: 0,
      }),
    ).not.toThrow();
  });

  it("stops annuity loan at 0 without overpayment and records reachedZeroAtMonth", () => {
    const loan = makeLoan({
      currentBalanceCents: 150_000,
      monthlyRateCents: 100_000,
      interestRateBps: 1200, // 1% / month
    });

    const res = projectContractBalance(loan, "2026-07-01");
    expect(res.projectedBalanceCents).toBe(0);
    expect(res.reachedZeroAtMonth).toBe(2);
    expect(res.totalPrincipalPaidCents).toBe(150_000);
    // Month 1: int 1500, bal 51500. Month 2: int 515, final pay 52015.
    expect(res.totalInterestAccruedCents).toBe(2_015);
    expect(res.totalContributionsCents).toBe(152_015);
  });

  it("handles negative amortization (rate < monthly interest) cleanly", () => {
    const loan = makeLoan({
      currentBalanceCents: 10_000_000,
      monthlyRateCents: 10_000,
      interestRateBps: 360, // 30_000 interest/month > 10_000 rate
    });

    const res = projectContractBalance(loan, "2026-02-01");
    expect(res.projectedBalanceCents).toBe(10_020_000);
    expect(res.totalPrincipalPaidCents).toBe(-20_000);
  });

  it("freezes paused and closed contracts and returns unprojected balance when asOfDate <= balanceAsOfDate", () => {
    const paused = makeLoan({ status: "paused" });
    const closed = makeLoan({ status: "closed" });
    const active = makeLoan({ status: "active" });

    expect(projectContractBalance(paused, "2026-06-01").isProjected).toBe(false);
    expect(
      projectContractBalance(paused, "2026-06-01").projectedBalanceCents,
    ).toBe(10_000_000);
    expect(projectContractBalance(closed, "2026-06-01").isProjected).toBe(false);
    expect(projectContractBalance(active, "2026-01-01").isProjected).toBe(false);
    expect(projectContractBalance(active, "2025-12-01").isProjected).toBe(false);
  });

  it("throws RangeError on invalid contract fields or dates", () => {
    expect(() =>
      projectContractBalance(makeLoan({ currentBalanceCents: -1 }), "2026-02-01"),
    ).toThrow(RangeError);
    expect(() =>
      projectContractBalance(
        makeLoan({ allocationThresholdPercent: 101 }),
        "2026-02-01",
      ),
    ).toThrow(RangeError);
    expect(() =>
      projectContractBalance(makeLoan(), "2026-02-30"),
    ).toThrow(RangeError);
  });
});

describe("extractContractMilestones", () => {
  it("extracts milestones and fixedInterestUntil, marks overdue, and skips closed contracts", () => {
    const contracts: DomainContract[] = [
      makeLoan({
        id: "c2",
        name: "Hauskredit Musterbank",
        milestoneDate: "2027-01-15",
        milestoneLabel: "Sondertilgung fällig",
        fixedInterestUntil: "2026-12-01",
      }),
      makeLoan({
        id: "c1",
        name: "Privatdarlehen",
        milestoneDate: "2026-11-01",
        milestoneLabel: "   ",
      }),
      makeLoan({
        id: "c3",
        name: "Altkredit",
        status: "closed",
        milestoneDate: "2026-11-20",
      }),
    ];

    const milestones = extractContractMilestones(contracts, "2026-11-16");
    expect(milestones).toHaveLength(3);
    expect(milestones[0]).toMatchObject({
      contractId: "c1",
      label: "Privatdarlehen",
      kind: "milestone",
      daysRemaining: -15,
      isOverdue: true,
    });
    expect(milestones[1]).toMatchObject({
      contractId: "c2",
      label: "Zinsbindungsende",
      kind: "fixed_interest_end",
      daysRemaining: 15,
      isOverdue: false,
    });
    expect(milestones[2]).toMatchObject({
      contractId: "c2",
      label: "Sondertilgung fällig",
      kind: "milestone",
      isOverdue: false,
    });
  });
});

describe("stepContractMonth", () => {
  it("steps an annuity loan normally", () => {
    const step = stepContractMonth(
      {
        category: "loan",
        repaymentType: "annuity",
        monthlyRateCents: 100_000,
        interestRateBps: 360,
      },
      10_000_000,
    );
    expect(step).toEqual({
      balanceCents: 9_930_000,
      interestCents: 30_000,
      principalCents: 70_000,
      paymentCents: 100_000,
      paidOff: false,
    });
  });

  it("caps final annuity month payment to balance + interest", () => {
    const step = stepContractMonth(
      {
        category: "loan",
        repaymentType: "annuity",
        monthlyRateCents: 100_000,
        interestRateBps: 360,
      },
      50_000,
    );
    expect(step).toEqual({
      balanceCents: 0,
      interestCents: 150,
      principalCents: 50_000,
      paymentCents: 50_150,
      paidOff: true,
    });
  });

  it("grows balance when annuity rate is below interest", () => {
    const step = stepContractMonth(
      {
        category: "loan",
        repaymentType: "annuity",
        monthlyRateCents: 10_000,
        interestRateBps: 360,
      },
      10_000_000,
    );
    expect(step).toEqual({
      balanceCents: 10_020_000,
      interestCents: 30_000,
      principalCents: -20_000,
      paymentCents: 10_000,
      paidOff: false,
    });
  });

  it("steps an installment loan with principal = min(rate, balance)", () => {
    const step1 = stepContractMonth(
      {
        category: "loan",
        repaymentType: "installment",
        monthlyRateCents: 100_000,
        interestRateBps: 600,
      },
      1_200_000,
    );
    expect(step1).toEqual({
      balanceCents: 1_100_000,
      interestCents: 6_000,
      principalCents: 100_000,
      paymentCents: 106_000,
      paidOff: false,
    });

    const stepLast = stepContractMonth(
      {
        category: "loan",
        repaymentType: "installment",
        monthlyRateCents: 100_000,
        interestRateBps: 600,
      },
      40_000,
    );
    expect(stepLast).toEqual({
      balanceCents: 0,
      interestCents: 200,
      principalCents: 40_000,
      paymentCents: 40_200,
      paidOff: true,
    });
  });

  it("keeps lump_sum loan balance constant and pays interest only", () => {
    const step = stepContractMonth(
      {
        category: "loan",
        repaymentType: "lump_sum",
        monthlyRateCents: 0,
        interestRateBps: 360,
      },
      1_000_000,
    );
    expect(step).toEqual({
      balanceCents: 1_000_000,
      interestCents: 3_000,
      principalCents: 0,
      paymentCents: 3_000,
      paidOff: false,
    });
  });

  it("steps a negative savings_contract (Abschlussgebühr) without interest on the negative part", () => {
    const step = stepContractMonth(
      {
        category: "savings_contract",
        monthlyRateCents: 50_000,
        interestRateBps: 120,
      },
      -120_000,
    );
    expect(step).toEqual({
      balanceCents: -70_000,
      interestCents: 0,
      principalCents: 0,
      paymentCents: 50_000,
      paidOff: false,
    });
  });

  it("starts paying interest once a negative savings balance has turned positive", () => {
    // Monat 1: -30.000 + 50.000 = 20.000 (kein Zins, Saldo war negativ).
    const first = stepContractMonth(
      { category: "savings_contract", monthlyRateCents: 50_000, interestRateBps: 1200 },
      -30_000,
    );
    expect(first.balanceCents).toBe(20_000);
    expect(first.interestCents).toBe(0);
    // Monat 2: Zins auf 20.000 bei 1 %/Monat = 200.
    const second = stepContractMonth(
      { category: "savings_contract", monthlyRateCents: 50_000, interestRateBps: 1200 },
      first.balanceCents,
    );
    expect(second.interestCents).toBe(200);
    expect(second.balanceCents).toBe(70_200);
  });

  it("still rejects a negative loan balance in stepContractMonth", () => {
    expect(() =>
      stepContractMonth(
        { category: "loan", monthlyRateCents: 50_000, interestRateBps: 120, repaymentType: "annuity" },
        -1,
      ),
    ).toThrow(RangeError);
  });

  it("steps a savings_contract with rate + interest", () => {
    const step = stepContractMonth(
      {
        category: "savings_contract",
        monthlyRateCents: 50_000,
        interestRateBps: 120,
      },
      1_900_000,
    );
    expect(step).toEqual({
      balanceCents: 1_951_900,
      interestCents: 1_900,
      principalCents: 0,
      paymentCents: 50_000,
      paidOff: false,
    });
  });

  it("handles 0% interest with principal = rate", () => {
    const step = stepContractMonth(
      {
        category: "loan",
        repaymentType: "annuity",
        monthlyRateCents: 100_000,
        interestRateBps: 0,
      },
      1_200_000,
    );
    expect(step).toEqual({
      balanceCents: 1_100_000,
      interestCents: 0,
      principalCents: 100_000,
      paymentCents: 100_000,
      paidOff: false,
    });
  });

  it("treats 0 balance loan as no-op", () => {
    const step = stepContractMonth(
      {
        category: "loan",
        repaymentType: "annuity",
        monthlyRateCents: 100_000,
        interestRateBps: 360,
      },
      0,
    );
    expect(step).toEqual({
      balanceCents: 0,
      interestCents: 0,
      principalCents: 0,
      paymentCents: 0,
      paidOff: false,
    });
  });
});

describe("applyCappedSpecialRepayment", () => {
  it("applies full amount when under cap and debt", () => {
    expect(applyCappedSpecialRepayment(1_000_000, 200_000, 500_000)).toEqual({
      appliedCents: 200_000,
      capOverflowCents: 0,
      exceedsDebtCents: 0,
    });
  });

  it("applies exact cap when amount equals cap", () => {
    expect(applyCappedSpecialRepayment(1_000_000, 500_000, 500_000)).toEqual({
      appliedCents: 500_000,
      capOverflowCents: 0,
      exceedsDebtCents: 0,
    });
  });

  it("reports capOverflowCents when amount exceeds cap", () => {
    expect(applyCappedSpecialRepayment(1_000_000, 800_000, 500_000)).toEqual({
      appliedCents: 500_000,
      capOverflowCents: 300_000,
      exceedsDebtCents: 0,
    });
  });

  it("reports full amount as overflow when cap is 0", () => {
    expect(applyCappedSpecialRepayment(1_000_000, 300_000, 0)).toEqual({
      appliedCents: 0,
      capOverflowCents: 300_000,
      exceedsDebtCents: 0,
    });
  });

  it("reports exceedsDebtCents when amount exceeds debt", () => {
    expect(applyCappedSpecialRepayment(200_000, 350_000, 500_000)).toEqual({
      appliedCents: 200_000,
      capOverflowCents: 0,
      exceedsDebtCents: 150_000,
    });
  });

  it("reports exceedsDebtCents = amount when debt is 0", () => {
    expect(applyCappedSpecialRepayment(0, 100_000, 500_000)).toEqual({
      appliedCents: 0,
      capOverflowCents: 0,
      exceedsDebtCents: 100_000,
    });
  });
});

describe("getCalibrationAge", () => {
  it("treats 12 months as not stale, 13 months as stale, and same date as 0", () => {
    expect(
      getCalibrationAge({ balanceAsOfDate: "2025-11-19" }, "2025-11-19"),
    ).toEqual({ months: 0, isStale: false });

    expect(
      getCalibrationAge({ balanceAsOfDate: "2025-11-19" }, "2026-11-19"),
    ).toEqual({ months: 12, isStale: false });

    expect(
      getCalibrationAge({ balanceAsOfDate: "2025-10-19" }, "2026-11-19"),
    ).toEqual({ months: 13, isStale: true });
  });
});
