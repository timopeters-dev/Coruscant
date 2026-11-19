import { describe, expect, it } from "vitest";
import { type DomainContract, projectContractBalance } from "./contracts";
import {
  buildAmortizationSeries,
  buildContractOverview,
  compareSpecialRepayment,
  effectiveAsOf,
  sampleSeries,
} from "./contract-series";

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
