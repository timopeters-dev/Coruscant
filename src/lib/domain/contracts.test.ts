import { describe, expect, it } from "vitest";
import {
  calculateMonthlyInterestCents,
  type DomainContract,
  extractContractMilestones,
  projectContractBalance,
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
