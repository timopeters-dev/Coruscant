import { describe, expect, it } from "vitest";
import { type DomainContract, projectContractBalance } from "@/domain/contracts/contract";
import { buildAmortizationSeries, effectiveAsOf, sampleSeries } from "@/domain/contracts/amortization";
import { buildContractOverview } from "@/domain/contracts/overview";
import { buildRateChangeTimingSeries, compareLoanAdjustments, compareSpecialRepayment, summarizeYearlyPaymentSplit } from "@/domain/contracts/loan-adjustments";

function makeLoan(overrides: Partial<DomainContract> = {}): DomainContract {
  return {
    id: "loan-muster",
    name: "Musterbank Annuität",
    category: "loan",
    status: "active",
    currentBalanceCents: 10_000_000, // 100.000 €
    balanceAsOfDate: "2026-01-01",
    monthlyRateCents: 100_000, // 1.000 €
    interestRateBps: 360, // 3,60 %
    repaymentType: "annuity",
    fixedInterestUntil: "2030-01-01",
    specialRepaymentMaxYearlyCents: 500_000, // 5.000 €
    ...overrides,
  };
}

function makeBausparer(overrides: Partial<DomainContract> = {}): DomainContract {
  return {
    id: "sav-muster",
    name: "Bausparvertrag Musterkasse",
    category: "savings_contract",
    status: "active",
    currentBalanceCents: 1_900_000, // 19.000 €
    balanceAsOfDate: "2026-01-01",
    monthlyRateCents: 50_000, // 500 €
    interestRateBps: 120, // 1,20 %
    targetSumCents: 5_000_000, // 50.000 €
    allocationThresholdPercent: 40, // 20.000 €
    ...overrides,
  };
}

describe("buildAmortizationSeries", () => {
  it("handles 0% interest annuity in exact 12 steps", () => {
    const loan = makeLoan({
      currentBalanceCents: 1_200_000,
      monthlyRateCents: 100_000,
      interestRateBps: 0,
      fixedInterestUntil: null,
    });
    const res = buildAmortizationSeries(loan, { asOfDate: "2026-01-01" });
    expect(res.points).toHaveLength(13); // 0..12
    expect(res.totalInterestCents).toBe(0);
    expect(res.paidOffMonthIndex).toBe(12);
    expect(res.paidOffDate).toBe("2027-01-01");
    expect(res.points[12]!.balanceCents).toBe(0);
  });

  it("caps overpayment in month 1 without negative balance", () => {
    const loan = makeLoan({
      currentBalanceCents: 50_000,
      monthlyRateCents: 100_000,
      interestRateBps: 360,
    });
    const res = buildAmortizationSeries(loan, { asOfDate: "2026-01-01" });
    expect(res.paidOffMonthIndex).toBe(1);
    expect(res.points[res.points.length - 1]!.balanceCents).toBe(0);
    expect(res.points.every((p) => p.balanceCents >= 0)).toBe(true);
  });

  it("ends series at payoff month with paid_off marker and exact paidOffDate", () => {
    const loan = makeLoan({
      currentBalanceCents: 600_000,
      monthlyRateCents: 100_000,
      interestRateBps: 0,
      fixedInterestUntil: null,
    });
    const res = buildAmortizationSeries(loan, { asOfDate: "2026-02-01" });
    expect(res.paidOffMonthIndex).toBe(6);
    expect(res.paidOffDate).toBe("2026-07-01");
    expect(res.points[res.points.length - 1]!.monthIndex).toBe(6);
    expect(res.markers.some((m) => m.kind === "paid_off" && m.date === "2026-07-01")).toBe(
      true,
    );
  });

  it("caps special repayment at yearly limit, resets per calendar year, and respects usedThisYearCents", () => {
    const loan = makeLoan({
      currentBalanceCents: 10_000_000,
      monthlyRateCents: 100_000,
      interestRateBps: 360,
      specialRepaymentMaxYearlyCents: 500_000, // 5.000 €/Jahr
    });

    const oneTime = buildAmortizationSeries(loan, {
      asOfDate: "2026-06-01",
      specialRepayment: {
        amountCents: 800_000,
        date: "2026-07-01",
        repeatYearly: false,
      },
    });
    expect(oneTime.special).toEqual({
      requestedCents: 800_000,
      appliedCents: 500_000,
      capOverflowCents: 300_000,
      exceedsDebtCents: 0,
      afterPayoffIgnoredCents: 0,
    });

    const repeating = buildAmortizationSeries(loan, {
      asOfDate: "2026-06-01",
      specialRepayment: {
        amountCents: 400_000,
        date: "2026-12-01",
        repeatYearly: true,
        usedThisYearCents: 200_000, // 300.000 übrig in 2026, danach volle 400.000 in 2027+
      },
    });
    expect(repeating.special).not.toBeNull();
    // In 2026 (month 11): 300_000 applied, 100_000 overflow
    expect(repeating.points[11]!.cumulativeSpecialCents).toBe(300_000);
    // In 2027 (month 23): full 400_000 applied -> 700_000 cumulative
    expect(repeating.points[23]!.cumulativeSpecialCents).toBe(700_000);
    expect(repeating.special!.capOverflowCents).toBeGreaterThanOrEqual(100_000);
  });

  it("ignores special repayment scheduled after payoff and matches baseline", () => {
    const loan = makeLoan({
      currentBalanceCents: 200_000,
      monthlyRateCents: 100_000,
      interestRateBps: 0,
      fixedInterestUntil: null,
    });
    const baseline = buildAmortizationSeries(loan, { asOfDate: "2026-04-01" });
    const withLateSpecial = buildAmortizationSeries(loan, {
      asOfDate: "2026-04-01",
      specialRepayment: {
        amountCents: 150_000,
        date: "2026-05-01",
        repeatYearly: false,
      },
    });

    expect(withLateSpecial.special?.afterPayoffIgnoredCents).toBe(150_000);
    expect(withLateSpecial.special?.appliedCents).toBe(0);
    expect(withLateSpecial.points).toEqual(baseline.points);
  });

  it("throws RangeError for special repayment before asOfDate or on savings_contract", () => {
    const loan = makeLoan();
    expect(() =>
      buildAmortizationSeries(loan, {
        asOfDate: "2026-06-01",
        specialRepayment: {
          amountCents: 100_000,
          date: "2026-05-01",
          repeatYearly: false,
        },
      }),
    ).toThrow(RangeError);

    const bausparer = makeBausparer();
    expect(() =>
      buildAmortizationSeries(bausparer, {
        asOfDate: "2026-06-01",
        specialRepayment: {
          amountCents: 100_000,
          date: "2026-07-01",
          repeatYearly: false,
        },
      }),
    ).toThrow(RangeError);
  });

  it("keeps lump_sum loan flat, counts interest, and applies special repayment", () => {
    const loan = makeLoan({
      repaymentType: "lump_sum",
      currentBalanceCents: 2_000_000,
      monthlyRateCents: 0,
      interestRateBps: 360,
      fixedInterestUntil: "2038-01-01",
      milestoneDate: "2040-01-01",
      specialRepaymentMaxYearlyCents: null,
    });
    const baseline = buildAmortizationSeries(loan, { asOfDate: "2026-01-01" });
    expect(baseline.flags.lumpSum).toBe(true);
    // 2026-01-01 to 2040-01-01 = 168 months (> 120 default)
    expect(baseline.points).toHaveLength(169);
    expect(baseline.points.every((p) => p.balanceCents === 2_000_000)).toBe(true);
    expect(baseline.totalInterestCents).toBeGreaterThan(0);

    const withSpecial = buildAmortizationSeries(loan, {
      asOfDate: "2026-01-01",
      specialRepayment: {
        amountCents: 500_000,
        date: "2026-02-01",
        repeatYearly: false,
      },
    });
    expect(withSpecial.flags.capUnknown).toBe(true);
    expect(withSpecial.points[168]!.balanceCents).toBe(1_500_000);
    expect(withSpecial.totalInterestCents).toBeLessThan(baseline.totalInterestCents);
  });

  it("matches projectContractBalance at asOfMonthIndex for installment and annuity", () => {
    const installment = makeLoan({
      repaymentType: "installment",
      currentBalanceCents: 1_200_000,
      monthlyRateCents: 100_000,
      interestRateBps: 600,
    });
    const instSeries = buildAmortizationSeries(installment, {
      asOfDate: "2026-04-01",
    });
    const instProj = projectContractBalance(installment, "2026-04-01");
    expect(instSeries.points[instSeries.asOfMonthIndex]!.balanceCents).toBe(
      instProj.projectedBalanceCents,
    );
    expect(instSeries.points[1]!.balanceCents).toBe(1_100_000);
    expect(instSeries.points[2]!.balanceCents).toBe(1_000_000);

    const annuity = makeLoan();
    const annSeries = buildAmortizationSeries(annuity, {
      asOfDate: "2026-07-01",
    });
    const annProj = projectContractBalance(annuity, "2026-07-01");
    expect(annSeries.points[annSeries.asOfMonthIndex]!.balanceCents).toBe(
      annProj.projectedBalanceCents,
    );
    for (let i = 1; i < annSeries.points.length; i += 1) {
      expect(annSeries.points[i]!.balanceCents).toBeLessThanOrEqual(
        annSeries.points[i - 1]!.balanceCents,
      );
    }
  });

  it("sets missingFixedInterestEnd and null fixed-end values when fixedInterestUntil is missing or before start", () => {
    const noFixed = makeLoan({ fixedInterestUntil: null });
    const res1 = buildAmortizationSeries(noFixed, { asOfDate: "2026-01-01" });
    expect(res1.flags.missingFixedInterestEnd).toBe(true);
    expect(res1.balanceAtFixedInterestEndCents).toBeNull();
    expect(res1.interestUntilFixedEndCents).toBeNull();
    expect(res1.markers.some((m) => m.kind === "fixed_interest_end")).toBe(false);

    const pastFixed = makeLoan({ fixedInterestUntil: "2025-06-01" });
    const res2 = buildAmortizationSeries(pastFixed, { asOfDate: "2026-01-01" });
    expect(res2.flags.missingFixedInterestEnd).toBe(false);
    expect(res2.balanceAtFixedInterestEndCents).toBeNull();
    expect(res2.interestUntilFixedEndCents).toBeNull();
    expect(res2.markers.some((m) => m.kind === "fixed_interest_end")).toBe(false);
  });

  it("handles loan with 0 rate (annuity grows, installment stays flat)", () => {
    const annuityZero = makeLoan({
      monthlyRateCents: 0,
      interestRateBps: 360,
    });
    const resAnn = buildAmortizationSeries(annuityZero, {
      asOfDate: "2026-01-01",
    });
    expect(resAnn.flags.noRate).toBe(true);
    expect(resAnn.flags.rateBelowInterest).toBe(true);
    expect(resAnn.flags.neverPaysOff).toBe(true);
    expect(resAnn.flags.horizonCapped).toBe(true);
    expect(resAnn.points).toHaveLength(481);
    expect(resAnn.points[480]!.balanceCents).toBeGreaterThan(
      resAnn.points[0]!.balanceCents,
    );

    const instZero = makeLoan({
      repaymentType: "installment",
      monthlyRateCents: 0,
      interestRateBps: 360,
    });
    const resInst = buildAmortizationSeries(instZero, {
      asOfDate: "2026-01-01",
    });
    expect(resInst.flags.noRate).toBe(true);
    expect(resInst.flags.neverPaysOff).toBe(true);
    expect(resInst.points[480]!.balanceCents).toBe(resInst.points[0]!.balanceCents);
  });

  it("freezes paused contracts to 2 flat points", () => {
    const paused = makeLoan({ status: "paused" });
    const res = buildAmortizationSeries(paused, { asOfDate: "2026-07-01" });
    expect(res.flags.notProjected).toBe(true);
    expect(res.points).toHaveLength(2);
    expect(res.points[0]!.balanceCents).toBe(10_000_000);
    expect(res.points[1]!.balanceCents).toBe(10_000_000);
    expect(res.points[1]!.monthIndex).toBe(6);
  });

  it("projects savings_contract with exact BigInt threshold, no-target 120 months, and 0-rate flat", () => {
    // Exact threshold boundary: 1_900_000 + 50_000 + 0 = 1_950_000 (not 40% of 5M = 2M)
    // Next month: 2_000_000 >= 2_000_000 exact!
    const exactThreshold = makeBausparer({
      currentBalanceCents: 1_900_000,
      monthlyRateCents: 50_000,
      interestRateBps: 0,
      targetSumCents: 5_000_000,
      allocationThresholdPercent: 40,
    });
    const res = buildAmortizationSeries(exactThreshold, {
      asOfDate: "2026-01-01",
    });
    expect(res.allocationThresholdDate).toBe("2026-03-01");
    expect(res.targetReachedDate).toBe("2031-03-01"); // 62 months
    expect(
      res.markers.some(
        (m) => m.kind === "allocation_threshold" && m.date === "2026-03-01",
      ),
    ).toBe(true);
    expect(
      res.markers.some(
        (m) => m.kind === "target_reached" && m.date === "2031-03-01",
      ),
    ).toBe(true);

    const noTarget = makeBausparer({ targetSumCents: null });
    const resNoTarget = buildAmortizationSeries(noTarget, {
      asOfDate: "2026-01-01",
    });
    expect(resNoTarget.points).toHaveLength(121);
    expect(resNoTarget.targetReachedDate).toBeNull();

    const flat = makeBausparer({ monthlyRateCents: 0, interestRateBps: 0 });
    const resFlat = buildAmortizationSeries(flat, { asOfDate: "2026-01-01" });
    expect(resFlat.targetReachedDate).toBeNull();
    expect(resFlat.points).toHaveLength(121);
  });

  it("places fixed_interest_end, milestone, and today markers deterministically", () => {
    const loan = makeLoan({
      milestoneDate: "2028-01-01",
      milestoneLabel: "Sondertilgungs-Check",
    });
    const res = buildAmortizationSeries(loan, { asOfDate: "2026-06-01" });
    const today = res.markers.find((m) => m.kind === "today");
    const fixed = res.markers.find((m) => m.kind === "fixed_interest_end");
    const milestone = res.markers.find((m) => m.kind === "milestone");

    expect(today?.monthIndex).toBe(res.asOfMonthIndex);
    expect(fixed?.balanceCents).toBe(res.points[48]!.balanceCents);
    expect(milestone?.label).toBe("Sondertilgungs-Check");
    // Sorted by date
    for (let i = 1; i < res.markers.length; i += 1) {
      expect(res.markers[i]!.date >= res.markers[i - 1]!.date).toBe(true);
    }
  });

  it("rejects out-of-bounds maxMonths, asOfDate < start, and negative amounts", () => {
    const loan = makeLoan();
    expect(() =>
      buildAmortizationSeries(loan, { asOfDate: "2026-01-01", maxMonths: 481 }),
    ).toThrow(RangeError);
    expect(() =>
      buildAmortizationSeries(loan, { asOfDate: "2025-12-31" }),
    ).toThrow(RangeError);
    expect(() =>
      buildAmortizationSeries(loan, {
        asOfDate: "2026-01-01",
        specialRepayment: {
          amountCents: -100,
          date: "2026-02-01",
          repeatYearly: false,
        },
      }),
    ).toThrow(RangeError);
  });
});

describe("compareSpecialRepayment", () => {
  it("computes positive monthsSaved and interestSaved for annuity loan", () => {
    const loan = makeLoan({
      currentBalanceCents: 10_000_000,
      monthlyRateCents: 100_000,
      interestRateBps: 360,
      specialRepaymentMaxYearlyCents: 500_000,
    });
    const effect = compareSpecialRepayment(loan, {
      asOfDate: "2026-01-01",
      specialRepayment: {
        amountCents: 500_000,
        date: "2026-02-01",
        repeatYearly: true,
      },
    });
    expect(effect.monthsSaved).toBeGreaterThan(0);
    expect(effect.interestSavedTotalCents).toBeGreaterThan(0);
    expect(effect.balanceAtFixedEndDeltaCents).toBeGreaterThan(0);
    expect(effect.interestSavedUntilFixedEndCents).toBeGreaterThan(0);
  });

  it("returns monthsSaved = null when baseline never pays off", () => {
    const loan = makeLoan({
      monthlyRateCents: 0,
      interestRateBps: 360,
    });
    const effect = compareSpecialRepayment(loan, {
      asOfDate: "2026-01-01",
      specialRepayment: {
        amountCents: 500_000,
        date: "2026-02-01",
        repeatYearly: false,
      },
    });
    expect(effect.monthsSaved).toBeNull();
    expect(effect.interestSavedTotalCents).toBeGreaterThan(0);
  });

  it("returns 0 deltas when special repayment amount is 0", () => {
    const loan = makeLoan();
    const effect = compareSpecialRepayment(loan, {
      asOfDate: "2026-01-01",
      specialRepayment: {
        amountCents: 0,
        date: "2026-02-01",
        repeatYearly: false,
      },
    });
    expect(effect.monthsSaved).toBe(0);
    expect(effect.interestSavedTotalCents).toBe(0);
    expect(effect.balanceAtFixedEndDeltaCents).toBe(0);
    expect(effect.interestSavedUntilFixedEndCents).toBe(0);
  });
});

describe("buildContractOverview and sampleSeries", () => {
  it("samples series to <= 24 points preserving first and last", () => {
    const long = Array.from({ length: 120 }, (_, i) => 120 - i);
    const sampled = sampleSeries(long, 24);
    expect(sampled).toHaveLength(24);
    expect(sampled[0]).toBe(120);
    expect(sampled[23]).toBe(1);

    const short = [100, 80, 60];
    expect(sampleSeries(short, 24)).toEqual([100, 80, 60]);

    expect(() => sampleSeries([1, 2, 3], 1)).toThrow(RangeError);
  });

  it("builds contract overview for loan and bausparer", () => {
    const loan = makeLoan({ balanceAsOfDate: "2025-01-01" });
    const overview = buildContractOverview(loan, "2026-06-01");
    expect(overview.sparklineCents.length).toBeLessThanOrEqual(24);
    expect(overview.sparklineCents.length).toBeGreaterThan(2);
    expect(overview.isCalibrationStale).toBe(true);
    expect(overview.calibrationAgeMonths).toBe(17);

    const bausparer = makeBausparer();
    const savOverview = buildContractOverview(bausparer, "2026-01-01");
    expect(savOverview.targetProgressBps).toBe(3800);
    expect(savOverview.thresholdBps).toBe(4000);
    expect(savOverview.isCalibrationStale).toBe(false);
  });

  it("handles future balanceAsOfDate in buildContractOverview and effectiveAsOf without throwing", () => {
    expect(effectiveAsOf("2026-11-19", "2026-12-01")).toBe("2026-12-01");
    expect(effectiveAsOf("2026-12-05", "2026-12-01")).toBe("2026-12-05");

    const futureLoan = makeLoan({ balanceAsOfDate: "2026-12-01" });
    const overview = buildContractOverview(futureLoan, "2026-11-19");
    expect(overview.isCalibrationStale).toBe(false);
    expect(overview.calibrationAgeMonths).toBe(0);
    expect(overview.sparklineCents.length).toBeGreaterThan(1);
    expect(overview.notProjected).toBe(false);
    expect(overview.lumpSum).toBe(false);
  });

  it("marks paused annuity as notProjected=true and lumpSum=false in buildContractOverview", () => {
    const pausedAnnuity = makeLoan({ status: "paused" });
    const pausedOverview = buildContractOverview(pausedAnnuity, "2026-06-01");
    expect(pausedOverview.notProjected).toBe(true);
    expect(pausedOverview.lumpSum).toBe(false);
    expect(pausedOverview.paidOffDate).toBeNull();
    expect(pausedOverview.neverPaysOff).toBe(false);

    const lumpSumLoan = makeLoan({
      repaymentType: "lump_sum",
      monthlyRateCents: 0,
    });
    const lumpOverview = buildContractOverview(lumpSumLoan, "2026-06-01");
    expect(lumpOverview.notProjected).toBe(false);
    expect(lumpOverview.lumpSum).toBe(true);
  });
});

describe("fix-review regression cases", () => {
  it("reports afterPayoffIgnoredCents when repeatYearly special repayment starts after payoff", () => {
    const loan = makeLoan({
      currentBalanceCents: 200_000,
      monthlyRateCents: 100_000,
      interestRateBps: 0,
      fixedInterestUntil: null,
    });
    const res = buildAmortizationSeries(loan, {
      asOfDate: "2026-04-01",
      specialRepayment: {
        amountCents: 150_000,
        date: "2026-05-01",
        repeatYearly: true,
      },
    });
    expect(res.special?.afterPayoffIgnoredCents).toBe(150_000);
    expect(res.special?.appliedCents).toBe(0);
  });

  it("books mid-month special repayment at or after sr.date so asOfMonthIndex matches baseline", () => {
    const loan = makeLoan({
      balanceAsOfDate: "2026-03-28",
      currentBalanceCents: 20_000_000,
      monthlyRateCents: 100_000,
      interestRateBps: 360,
    });
    const baseline = buildAmortizationSeries(loan, { asOfDate: "2026-11-19" });
    const withSpecial = buildAmortizationSeries(loan, {
      asOfDate: "2026-11-19",
      specialRepayment: {
        amountCents: 500_000,
        date: "2026-11-19",
        repeatYearly: false,
      },
    });

    // asOfMonthIndex = 7 (2026-10-28 < 2026-11-19), so point 7 must match baseline
    expect(withSpecial.asOfMonthIndex).toBe(7);
    expect(withSpecial.points[7]!.balanceCents).toBe(
      baseline.points[7]!.balanceCents,
    );
    // Booked at point 8 (2026-11-28 >= 2026-11-19)
    expect(withSpecial.points[8]!.cumulativeSpecialCents).toBe(500_000);
  });

  it("computes allocationThresholdCents with BigInt half-up rounding", () => {
    const bausparer = makeBausparer({
      targetSumCents: 101,
      allocationThresholdPercent: 50,
    });
    const res = buildAmortizationSeries(bausparer, { asOfDate: "2026-01-01" });
    // 101 * 50 / 100 = 50.5 -> 51
    expect(res.allocationThresholdCents).toBe(51);
  });
});

describe("payment split, rate changes, and timing (Slice 24)", () => {
  it("records exact monthly payment split for annuity and installment including final partial month and zero at month 0", () => {
    const annuity = makeLoan({
      currentBalanceCents: 250_000,
      monthlyRateCents: 100_000,
      interestRateBps: 360,
      fixedInterestUntil: null,
    });
    const annRes = buildAmortizationSeries(annuity, { asOfDate: "2026-01-01" });
    expect(annRes.points[0]!.interestCents).toBe(0);
    expect(annRes.points[0]!.principalCents).toBe(0);
    expect(annRes.points[0]!.monthlyRateCents).toBe(0);
    for (const pt of annRes.points.slice(1)) {
      expect(pt.interestCents + pt.principalCents).toBe(pt.monthlyRateCents);
    }
    const lastAnn = annRes.points[annRes.points.length - 1]!;
    expect(lastAnn.monthlyRateCents).toBeLessThan(100_000);
    expect(lastAnn.balanceCents).toBe(0);

    const installment = makeLoan({
      repaymentType: "installment",
      currentBalanceCents: 250_000,
      monthlyRateCents: 100_000,
      interestRateBps: 360,
      fixedInterestUntil: null,
    });
    const instRes = buildAmortizationSeries(installment, {
      asOfDate: "2026-01-01",
    });
    expect(instRes.points[0]!.principalCents).toBe(0);
    expect(instRes.points[0]!.monthlyRateCents).toBe(0);
    for (const pt of instRes.points.slice(1)) {
      expect(pt.principalCents).toBe(pt.monthlyRateCents);
    }
    const lastInst = instRes.points[instRes.points.length - 1]!;
    expect(lastInst.principalCents).toBe(50_000);
    expect(lastInst.monthlyRateCents).toBe(50_000);
  });

  it("handles rate increase, decrease, identical rate, below-interest rate, clamping, and disallowed states", () => {
    const loan = makeLoan({
      currentBalanceCents: 10_000_000,
      originalPrincipalCents: 10_000_000,
      monthlyRateCents: 100_000,
      interestRateBps: 360, // monthly interest at start = 30_000
      rateChangeRight: "allowed",
      rateChangeTotalCount: 2,
      rateChangeScope: "fixed_period",
      rateChangeUsedCount: 0,
      rateChangeMinMonthlyCents: 50_000,
      rateChangeMaxMonthlyCents: 150_000,
      fixedInterestUntil: "2030-01-01",
    });

    const baseline = buildAmortizationSeries(loan, { asOfDate: "2026-01-01" });

    // Increase reduces balance and duration and sets rate_change marker
    const raised = buildAmortizationSeries(loan, {
      asOfDate: "2026-01-01",
      rateChange: { date: "2026-04-01", newMonthlyRateCents: 130_000 },
    });
    expect(raised.rateChange).toEqual({
      requestedCents: 130_000,
      appliedCents: 130_000,
      clamped: false,
      notAllowed: false,
      afterLatestDate: false,
    });
    expect(raised.paidOffMonthIndex!).toBeLessThan(baseline.paidOffMonthIndex!);
    expect(raised.totalInterestCents).toBeLessThan(baseline.totalInterestCents);
    expect(
      raised.markers.some(
        (m) => m.kind === "rate_change" && m.date === "2026-04-01",
      ),
    ).toBe(true);

    // Decrease lengthens duration
    const lowered = buildAmortizationSeries(loan, {
      asOfDate: "2026-01-01",
      rateChange: { date: "2026-04-01", newMonthlyRateCents: 60_000 },
    });
    expect(lowered.paidOffMonthIndex!).toBeGreaterThan(
      baseline.paidOffMonthIndex!,
    );

    // Identical rate produces identical points and no rate_change marker
    const same = buildAmortizationSeries(loan, {
      asOfDate: "2026-01-01",
      rateChange: { date: "2026-04-01", newMonthlyRateCents: 100_000 },
    });
    expect(same.points).toEqual(baseline.points);
    expect(same.markers.some((m) => m.kind === "rate_change")).toBe(false);

    // Clamping to corridor max / min
    const clampedHi = buildAmortizationSeries(loan, {
      asOfDate: "2026-01-01",
      rateChange: { date: "2026-04-01", newMonthlyRateCents: 250_000 },
    });
    expect(clampedHi.rateChange?.clamped).toBe(true);
    expect(clampedHi.rateChange?.appliedCents).toBe(150_000);

    const clampedLo = buildAmortizationSeries(loan, {
      asOfDate: "2026-01-01",
      rateChange: { date: "2026-04-01", newMonthlyRateCents: 10_000 },
    });
    expect(clampedLo.rateChange?.clamped).toBe(true);
    expect(clampedLo.rateChange?.appliedCents).toBe(50_000);

    // Rate below monthly interest leads to neverPaysOff
    const lowCorridorLoan = makeLoan({
      ...loan,
      rateChangeMinMonthlyCents: 10_000,
    });
    const belowInterest = buildAmortizationSeries(lowCorridorLoan, {
      asOfDate: "2026-01-01",
      rateChange: { date: "2026-02-01", newMonthlyRateCents: 20_000 },
    });
    expect(belowInterest.flags.neverPaysOff).toBe(true);
    expect(belowInterest.flags.rateBelowInterest).toBe(true);

    // Disallowed: none, exhausted, lump_sum
    const noneRes = buildAmortizationSeries(
      makeLoan({ ...loan, rateChangeRight: "none" }),
      {
        asOfDate: "2026-01-01",
        rateChange: { date: "2026-04-01", newMonthlyRateCents: 130_000 },
      },
    );
    expect(noneRes.rateChange?.notAllowed).toBe(true);
    expect(noneRes.points).toEqual(baseline.points);

    const exhaustedRes = buildAmortizationSeries(
      makeLoan({ ...loan, rateChangeUsedCount: 2 }),
      {
        asOfDate: "2026-01-01",
        rateChange: { date: "2026-04-01", newMonthlyRateCents: 130_000 },
      },
    );
    expect(exhaustedRes.rateChange?.notAllowed).toBe(true);

    const lumpRes = buildAmortizationSeries(
      makeLoan({ repaymentType: "lump_sum", monthlyRateCents: 0 }),
      {
        asOfDate: "2026-01-01",
        rateChange: { date: "2026-04-01", newMonthlyRateCents: 100_000 },
      },
    );
    expect(lumpRes.rateChange?.notAllowed).toBe(true);

    // Date after latestChangeDate (fixed_period)
    const afterLatest = buildAmortizationSeries(loan, {
      asOfDate: "2026-01-01",
      rateChange: { date: "2030-06-01", newMonthlyRateCents: 130_000 },
    });
    expect(afterLatest.rateChange?.afterLatestDate).toBe(true);
    expect(afterLatest.points).toEqual(baseline.points);

    // Date before asOf throws RangeError
    expect(() =>
      buildAmortizationSeries(loan, {
        asOfDate: "2026-06-01",
        rateChange: { date: "2026-05-01", newMonthlyRateCents: 130_000 },
      }),
    ).toThrow(RangeError);

    // Rate change after payoff has no effect
    const quickLoan = makeLoan({
      ...loan,
      currentBalanceCents: 200_000,
      monthlyRateCents: 100_000,
      interestRateBps: 0,
      fixedInterestUntil: "2030-01-01",
    });
    const quickBase = buildAmortizationSeries(quickLoan, {
      asOfDate: "2026-01-01",
    });
    const quickAfterPayoff = buildAmortizationSeries(quickLoan, {
      asOfDate: "2026-01-01",
      rateChange: { date: "2026-06-01", newMonthlyRateCents: 150_000 },
    });
    expect(quickAfterPayoff.points).toEqual(quickBase.points);
    expect(quickAfterPayoff.markers.some((m) => m.kind === "rate_change")).toBe(
      false,
    );
  });

  it("recalculates percent_balance yearly cap dynamically and uses persisted usedCents as default", () => {
    const loan = makeLoan({
      currentBalanceCents: 10_000_000, // 100k
      monthlyRateCents: 100_000,
      interestRateBps: 360,
      specialRepaymentRight: "allowed",
      specialRepaymentBasis: "percent_balance",
      specialRepaymentPercentBps: 500, // 5 % of balance
      specialRepaymentMaxYearlyCents: null,
      specialRepaymentUsedCents: 200_000,
      specialRepaymentUsedYear: 2026,
    });

    const withDefaultUsed = buildAmortizationSeries(loan, {
      asOfDate: "2026-01-01",
      specialRepayment: {
        amountCents: 600_000,
        date: "2026-06-01",
        repeatYearly: true,
      },
    });
    // Year 2026: cap 5% of 10M = 500_000, persisted used = 200_000 -> applied = 300_000
    expect(withDefaultUsed.points[5]!.specialCents).toBe(300_000);
    // Year 2027: balance is lower -> 5% cap is strictly less than 500_000
    expect(withDefaultUsed.points[17]!.specialCents).toBeGreaterThan(0);
    expect(withDefaultUsed.points[17]!.specialCents).toBeLessThan(500_000);
    // Year 2028: strictly less than 2027
    expect(withDefaultUsed.points[29]!.specialCents).toBeLessThan(
      withDefaultUsed.points[17]!.specialCents,
    );

    // Explicit usedThisYearCents overrides persisted usage
    const withOverride = buildAmortizationSeries(loan, {
      asOfDate: "2026-01-01",
      specialRepayment: {
        amountCents: 600_000,
        date: "2026-06-01",
        repeatYearly: false,
        usedThisYearCents: 0,
      },
    });
    expect(withOverride.points[5]!.specialCents).toBe(500_000);
  });

  it("applies rate change and special repayment in the same month (rate first, then special) and computes compareLoanAdjustments", () => {
    const loan = makeLoan({
      currentBalanceCents: 10_000_000,
      originalPrincipalCents: 10_000_000,
      monthlyRateCents: 100_000,
      interestRateBps: 360,
      rateChangeRight: "allowed",
      rateChangeMinMonthlyCents: 80_000,
      rateChangeMaxMonthlyCents: 150_000,
      fixedInterestUntil: "2028-01-01",
    });

    const onlySpecial = compareLoanAdjustments(loan, {
      asOfDate: "2026-01-01",
      specialRepayment: {
        amountCents: 500_000,
        date: "2026-04-01",
        repeatYearly: false,
      },
    });
    const legacySpecial = compareSpecialRepayment(loan, {
      asOfDate: "2026-01-01",
      specialRepayment: {
        amountCents: 500_000,
        date: "2026-04-01",
        repeatYearly: false,
      },
    });
    expect(onlySpecial.interestSavedTotalCents).toBe(
      legacySpecial.interestSavedTotalCents,
    );
    expect(onlySpecial.extraPaidUntilFixedEndCents).toBe(500_000);

    const onlyRate = compareLoanAdjustments(loan, {
      asOfDate: "2026-01-01",
      rateChange: { date: "2026-04-01", newMonthlyRateCents: 120_000 },
    });
    // Fixed end is month 24; rate change starts at month 3 -> 22 months of +20_000 = 440_000
    expect(onlyRate.extraPaidUntilFixedEndCents).toBe(22 * 20_000);

    const both = compareLoanAdjustments(loan, {
      asOfDate: "2026-01-01",
      rateChange: { date: "2026-04-01", newMonthlyRateCents: 120_000 },
      specialRepayment: {
        amountCents: 500_000,
        date: "2026-04-01",
        repeatYearly: false,
      },
    });
    expect(both.adjusted.points[3]!.monthlyRateCents).toBe(120_000);
    expect(both.adjusted.points[3]!.specialCents).toBe(500_000);
    expect(both.extraPaidUntilFixedEndCents).toBe(22 * 20_000 + 500_000);
  });

  it("summarizes yearly payment split with partial start/end years, crossover, never-crossed, lump_sum, and 0% interest", () => {
    // Partial start year (starts 2026-07-01) and partial end year
    const loan = makeLoan({
      balanceAsOfDate: "2026-07-01",
      currentBalanceCents: 10_000_000,
      monthlyRateCents: 60_000, // 600 €, initial interest at 6% = 500 € -> principal 100 < interest 500 initially
      interestRateBps: 600,
      fixedInterestUntil: null,
    });
    const series = buildAmortizationSeries(loan, { asOfDate: "2026-07-01" });
    const summary = summarizeYearlyPaymentSplit(series.points);
    expect(summary.rows[0]!.year).toBe(2026);
    expect(summary.rows.length).toBeGreaterThan(2);
    expect(summary.crossoverDate).not.toBeNull();
    // Verify crossover point actually has principal >= interest
    const crossPt = series.points.find((p) => p.date === summary.crossoverDate)!;
    expect(crossPt.principalCents).toBeGreaterThanOrEqual(crossPt.interestCents);

    // Rate barely above interest within short horizon -> crossover null
    const shortSeries = buildAmortizationSeries(loan, {
      asOfDate: "2026-07-01",
      maxMonths: 24,
    });
    expect(summarizeYearlyPaymentSplit(shortSeries.points).crossoverDate).toBeNull();

    // lump_sum -> crossover null
    const lump = buildAmortizationSeries(
      makeLoan({ repaymentType: "lump_sum", monthlyRateCents: 0 }),
      { asOfDate: "2026-01-01" },
    );
    expect(summarizeYearlyPaymentSplit(lump.points).crossoverDate).toBeNull();

    // 0% interest -> crossover immediately at month 1
    const zeroInt = buildAmortizationSeries(
      makeLoan({ interestRateBps: 0, currentBalanceCents: 1_200_000 }),
      { asOfDate: "2026-01-01" },
    );
    expect(summarizeYearlyPaymentSplit(zeroInt.points).crossoverDate).toBe(
      zeroInt.points[1]!.date,
    );
  });

  it("builds rate change timing series: monotone non-increasing, thins to maxPoints, null delay cost <12m, empty when disallowed", () => {
    const loan = makeLoan({
      currentBalanceCents: 20_000_000,
      originalPrincipalCents: 20_000_000,
      monthlyRateCents: 100_000,
      interestRateBps: 360,
      rateChangeRight: "allowed",
      rateChangeMinMonthlyCents: 80_000,
      rateChangeMaxMonthlyCents: 200_000,
      fixedInterestUntil: "2036-01-01",
    });

    const timing = buildRateChangeTimingSeries(loan, {
      asOfDate: "2026-01-01",
      newMonthlyRateCents: 130_000,
      horizonEndDate: "2036-01-01",
      maxPoints: 15,
    });
    expect(timing.points).toHaveLength(15);
    expect(timing.points[0]!.startDate).toBe("2026-02-01");
    expect(timing.points[14]!.startDate).toBe("2036-01-01");
    for (let i = 1; i < timing.points.length; i += 1) {
      expect(timing.points[i]!.interestSavedCents).toBeLessThanOrEqual(
        timing.points[i - 1]!.interestSavedCents,
      );
    }
    expect(timing.costPerYearDelayCents).not.toBeNull();
    expect(timing.costPerYearDelayCents!).toBeGreaterThan(0);

    // Horizon < 12 months -> costPerYearDelayCents is null
    const shortTiming = buildRateChangeTimingSeries(loan, {
      asOfDate: "2026-01-01",
      newMonthlyRateCents: 130_000,
      horizonEndDate: "2026-10-01",
    });
    expect(shortTiming.points.length).toBeGreaterThan(0);
    expect(shortTiming.costPerYearDelayCents).toBeNull();

    // Disallowed -> empty points
    const disallowed = buildRateChangeTimingSeries(
      makeLoan({ ...loan, rateChangeRight: "none" }),
      {
        asOfDate: "2026-01-01",
        newMonthlyRateCents: 130_000,
        horizonEndDate: "2036-01-01",
      },
    );
    expect(disallowed.points).toEqual([]);
    expect(disallowed.costPerYearDelayCents).toBeNull();
  });

  it("does not throw and marks rateChange notAllowed when approximated corridor becomes empty after calibration", () => {
    const calibrated = makeLoan({
      originalPrincipalCents: null,
      currentBalanceCents: 15_000_000,
      interestRateBps: 380,
      monthlyRateCents: 120_000,
      rateChangeRight: "allowed",
      rateChangeTotalCount: 2,
      rateChangeScope: "fixed_period",
      rateChangeMinRepaymentBps: 100,
      rateChangeMaxRepaymentBps: 300,
      rateChangeMinMonthlyCents: 100_000,
      rateChangeMaxMonthlyCents: 160_000,
    });
    const series = buildAmortizationSeries(calibrated, {
      asOfDate: "2026-01-01",
      rateChange: { date: "2026-02-01", newMonthlyRateCents: 140_000 },
    });
    expect(series.rateChange?.notAllowed).toBe(true);
    expect(series.rateChange?.appliedCents).toBe(120_000);
  });
});
