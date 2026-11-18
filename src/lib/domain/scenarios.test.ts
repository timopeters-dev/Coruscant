import { describe, expect, it } from "vitest";
import type { DomainContract } from "./contracts";
import {
  MAX_ETF_RETURN_BPS,
  MIN_ETF_RETURN_BPS,
  applyMonthlyGrowth,
  buildPrepaymentDefaults,
  calculateEtfLiquidationTax,
  computeMonthlyGrowthFactor,
  findBreakEvenReturnBps,
  simulateCashflowChange,
  simulatePrepaymentVsEtf,
  type PrepaymentVsEtfInput,
} from "./scenarios";
import type { DomainPot } from "./waterfall";

const SCALE = 10n ** 12n;

describe("computeMonthlyGrowthFactor / applyMonthlyGrowth", () => {
  it("returns exactly the scale for 0 bps", () => {
    expect(computeMonthlyGrowthFactor(0)).toBe(SCALE);
    expect(applyMonthlyGrowth(123_456, SCALE)).toBe(123_456);
  });

  it("compounds to the effective annual return after 12 months", () => {
    for (const [bps, expected] of [
      [700, 10_700_000],
      [-5000, 5_000_000],
    ] as const) {
      const factor = computeMonthlyGrowthFactor(bps);
      let value = 10_000_000;
      for (let i = 0; i < 12; i += 1) value = applyMonthlyGrowth(value, factor);
      expect(Math.abs(value - expected)).toBeLessThanOrEqual(1);
    }
  });

  it("accepts the bounds and rejects out-of-range or non-integer values", () => {
    expect(() => computeMonthlyGrowthFactor(MIN_ETF_RETURN_BPS)).not.toThrow();
    expect(() => computeMonthlyGrowthFactor(MAX_ETF_RETURN_BPS)).not.toThrow();
    expect(() => computeMonthlyGrowthFactor(MIN_ETF_RETURN_BPS - 1)).toThrow(RangeError);
    expect(() => computeMonthlyGrowthFactor(MAX_ETF_RETURN_BPS + 1)).toThrow(RangeError);
    expect(() => computeMonthlyGrowthFactor(350.5)).toThrow(RangeError);
  });

  it("keeps 0 at 0 and rounds half-up", () => {
    expect(applyMonthlyGrowth(0, computeMonthlyGrowthFactor(900))).toBe(0);
    // 1 * 1.5 = 1.5 -> 2 ; 1 * 1.4999.. -> 1
    expect(applyMonthlyGrowth(1, (SCALE * 3n) / 2n)).toBe(2);
    expect(applyMonthlyGrowth(1, (SCALE * 3n) / 2n - 1n)).toBe(1);
    expect(() => applyMonthlyGrowth(-1, SCALE)).toThrow(RangeError);
    expect(() => applyMonthlyGrowth(1, 0n)).toThrow(RangeError);
  });
});

describe("calculateEtfLiquidationTax", () => {
  const base = {
    valueCents: 1_000_000 + 0,
    costBasisCents: 0,
    saverAllowanceCents: 0,
    partialExemptionBps: 0,
  };

  it("matches reference values for KiSt 0/8/9 %", () => {
    const t0 = calculateEtfLiquidationTax({ ...base, churchTaxBps: 0 });
    expect([t0.capitalGainsTaxCents, t0.soliCents, t0.churchTaxCents, t0.totalTaxCents]).toEqual([250_000, 13_750, 0, 263_750]);
    const t8 = calculateEtfLiquidationTax({ ...base, churchTaxBps: 800 });
    expect([t8.capitalGainsTaxCents, t8.soliCents, t8.churchTaxCents, t8.totalTaxCents]).toEqual([245_098, 13_480, 19_608, 278_186]);
    const t9 = calculateEtfLiquidationTax({ ...base, churchTaxBps: 900 });
    expect([t9.capitalGainsTaxCents, t9.soliCents, t9.churchTaxCents, t9.totalTaxCents]).toEqual([244_499, 13_447, 22_005, 279_951]);
    expect(t0.netValueCents).toBe(1_000_000 - 263_750);
  });

  it("applies partial exemption and allowance", () => {
    const t = calculateEtfLiquidationTax({
      valueCents: 300_000,
      costBasisCents: 100_000,
      saverAllowanceCents: 100_000,
      churchTaxBps: 0,
    });
    expect(t.taxablePartCents).toBe(140_000);
    expect(t.taxableCents).toBe(40_000);
    expect(t.totalTaxCents).toBe(10_550);
    expect(t.allowanceUsedCents).toBe(100_000);
  });

  it("handles allowance boundaries", () => {
    const common = { costBasisCents: 0, saverAllowanceCents: 100_000, churchTaxBps: 0 as const, partialExemptionBps: 0 };
    const eq = calculateEtfLiquidationTax({ ...common, valueCents: 100_000 });
    expect(eq.totalTaxCents).toBe(0);
    const plus1 = calculateEtfLiquidationTax({ ...common, valueCents: 100_001 });
    expect(plus1.taxableCents).toBe(1);
    expect(plus1.capitalGainsTaxCents).toBe(0);
    const plus4 = calculateEtfLiquidationTax({ ...common, valueCents: 100_004 });
    expect(plus4.taxableCents).toBe(4);
    expect(plus4.capitalGainsTaxCents).toBe(1);
    expect(plus4.soliCents).toBe(0);
    const big = calculateEtfLiquidationTax({ ...common, valueCents: 50_000 });
    expect(big.allowanceUsedCents).toBe(50_000);
    const none = calculateEtfLiquidationTax({ ...common, saverAllowanceCents: 0, valueCents: 100_000 });
    expect(none.allowanceUsedCents).toBe(0);
    expect(none.capitalGainsTaxCents).toBe(25_000);
  });

  it("charges no tax on losses or zero gain", () => {
    const t = calculateEtfLiquidationTax({ valueCents: 80_000, costBasisCents: 100_000, saverAllowanceCents: 0, churchTaxBps: 0 });
    expect(t.gainCents).toBe(0);
    expect(t.totalTaxCents).toBe(0);
    expect(t.netValueCents).toBe(80_000);
  });

  it("rejects invalid inputs", () => {
    const ok = { valueCents: 1, costBasisCents: 0, saverAllowanceCents: 0, churchTaxBps: 0 };
    expect(() => calculateEtfLiquidationTax({ ...ok, churchTaxBps: 500 })).toThrow(RangeError);
    expect(() => calculateEtfLiquidationTax({ ...ok, saverAllowanceCents: 200_001 })).toThrow(RangeError);
    expect(() => calculateEtfLiquidationTax({ ...ok, valueCents: -1 })).toThrow(RangeError);
    expect(() => calculateEtfLiquidationTax({ ...ok, costBasisCents: 1.5 })).toThrow(RangeError);
    expect(() => calculateEtfLiquidationTax({ ...ok, partialExemptionBps: 10_001 })).toThrow(RangeError);
  });
});

function makeInput(overrides: Partial<PrepaymentVsEtfInput> = {}, loan: Partial<PrepaymentVsEtfInput["loan"]> = {}): PrepaymentVsEtfInput {
  return {
    loan: {
      balanceCents: 10_000_000,
      interestRateBps: 350,
      monthlyRateCents: 60_000,
      repaymentType: "annuity",
      specialRepaymentMaxYearlyCents: 1_000_000,
      ...loan,
    },
    startDate: "2026-01-15",
    horizonEndDate: "2031-01-15",
    oneTimeAmountCents: 1_000_000,
    monthlyAmountCents: 20_000,
    etfAnnualReturnBps: 600,
    saverAllowanceCents: 100_000,
    churchTaxBps: 0,
    ...overrides,
  };
}

describe("simulatePrepaymentVsEtf", () => {
  it("keeps total cash out equal for all repayment types", () => {
    for (const repaymentType of ["annuity", "installment", "lump_sum", null] as const) {
      const r = simulatePrepaymentVsEtf(makeInput({}, { repaymentType }));
      expect(r.prepayment.totalCashOutCents).toBe(r.etf.totalCashOutCents);
    }
  });

  it("is equal at 0 % interest and 0 % return", () => {
    const r = simulatePrepaymentVsEtf(makeInput({ etfAnnualReturnBps: 0 }, { interestRateBps: 0 }));
    expect(r.netAdvantageEtfCents).toBe(0);
    expect(r.winner).toBe("equal");
  });

  it("favors the ETF at 0 % interest and positive return", () => {
    const r = simulatePrepaymentVsEtf(makeInput({}, { interestRateBps: 0 }));
    expect(r.winner).toBe("etf");
    expect(r.interestSavedCents).toBe(0);
  });

  it("favors prepayment at 0 % return and positive interest", () => {
    const r = simulatePrepaymentVsEtf(makeInput({ etfAnnualReturnBps: 0 }));
    expect(r.winner).toBe("prepayment");
    expect(-r.netAdvantageEtfCents).toBeGreaterThanOrEqual(r.interestSavedCents);
    expect(r.interestSavedCents).toBeGreaterThan(0);
  });

  it("cap 0 makes both variants identical", () => {
    const r = simulatePrepaymentVsEtf(makeInput({}, { specialRepaymentMaxYearlyCents: 0 }));
    expect(r.netAdvantageEtfCents).toBe(0);
    expect(r.prepayment.totalSpecialRepaymentCents).toBe(0);
    expect(r.capLimitedOverflowCents).toBeGreaterThan(0);
  });

  it("treats a null cap as unlimited and flags it", () => {
    const r = simulatePrepaymentVsEtf(makeInput({ oneTimeAmountCents: 5_000_000 }, { specialRepaymentMaxYearlyCents: null }));
    expect(r.flags.capUnknown).toBe(true);
    expect(r.prepayment.totalSpecialRepaymentCents).toBeGreaterThanOrEqual(5_000_000);
    expect(r.capLimitedOverflowCents).toBe(0);
  });

  it("routes the overflow above the remaining cap into ETF A", () => {
    const r = simulatePrepaymentVsEtf(
      makeInput({ oneTimeAmountCents: 1_500_000, monthlyAmountCents: 0, horizonEndDate: "2026-01-15" }, { specialRepaymentMaxYearlyCents: 1_000_000 }),
    );
    expect(r.prepayment.totalSpecialRepaymentCents).toBe(1_000_000);
    expect(r.prepayment.etfContributionsCents).toBe(500_000);
    expect(r.capLimitedOverflowCents).toBe(500_000);
  });

  it("respects usage already booked this year and resets on new year", () => {
    const r = simulatePrepaymentVsEtf(
      makeInput({
        startDate: "2026-11-15",
        horizonEndDate: "2027-01-15",
        oneTimeAmountCents: 100_000,
        monthlyAmountCents: 100_000,
        specialRepaymentUsedThisYearCents: 1_000_000,
      }),
    );
    // Months 0 and 1 (Dec 2026): cap exhausted -> no special repayment.
    // Month 2 (Jan 2027): cap reset -> special repayment resumes.
    expect(r.timeline[0]!.debtA).toBe(r.timeline[0]!.debtB);
    expect(r.timeline[1]!.debtA).toBe(r.timeline[1]!.debtB);
    expect(r.timeline[2]!.debtA).toBeLessThan(r.timeline[2]!.debtB);
  });

  it("resets the cap on each calendar-year change", () => {
    const r = simulatePrepaymentVsEtf(
      makeInput({
        startDate: "2026-11-15",
        horizonEndDate: "2028-12-15",
        oneTimeAmountCents: 0,
        monthlyAmountCents: 400_000,
      }, { specialRepaymentMaxYearlyCents: 600_000 }),
    );
    // Per calendar year at most 600_000 special repayment.
    // Nov+Dec 2026 (2 months) <= 600k, 2027 <= 600k, 2028 (12 months) <= 600k.
    expect(r.prepayment.totalSpecialRepaymentCents).toBeLessThanOrEqual(1_800_000);
    expect(r.prepayment.totalSpecialRepaymentCents).toBeGreaterThan(1_200_000);
  });

  it("pays off at month 0 when the one-time amount exceeds the debt", () => {
    const r = simulatePrepaymentVsEtf(
      makeInput({ oneTimeAmountCents: 300_000, monthlyAmountCents: 10_000 }, { balanceCents: 200_000, specialRepaymentMaxYearlyCents: null }),
    );
    expect(r.prepayment.paidOffAtMonth).toBe(0);
    expect(r.prepayment.remainingDebtCents).toBe(0);
    expect(r.prepayment.totalRegularPaymentCents).toBe(0);
    expect(r.prepayment.etfContributionsCents).toBe(
      r.prepayment.totalCashOutCents - 200_000,
    );
    expect(r.prepayment.etfContributionsCents).toBeGreaterThan(100_000 + 60 * 10_000);
    expect(r.prepayment.totalCashOutCents).toBe(r.etf.totalCashOutCents);
  });

  it("is identical for both variants when the start debt is 0", () => {
    const r = simulatePrepaymentVsEtf(makeInput({}, { balanceCents: 0 }));
    expect(r.netAdvantageEtfCents).toBe(0);
    expect(r.prepayment.totalCashOutCents).toBe(r.etf.totalCashOutCents);
  });

  it("redirects rate and savings to the ETF after full repayment", () => {
    const r = simulatePrepaymentVsEtf(
      makeInput({ oneTimeAmountCents: 1_000_000, monthlyAmountCents: 100_000 }, { balanceCents: 3_000_000, specialRepaymentMaxYearlyCents: null }),
    );
    const month = r.prepayment.paidOffAtMonth;
    expect(month).not.toBeNull();
    expect(month!).toBeGreaterThan(0);
    expect(month!).toBeLessThan(r.horizonMonths);
    expect(r.prepayment.remainingDebtCents).toBe(0);
    expect(r.timeline[month!]!.debtA).toBe(0);
    expect(r.timeline[month! - 1]!.debtA).toBeGreaterThan(0);
    expect(r.prepayment.totalCashOutCents).toBe(r.etf.totalCashOutCents);
  });

  it("reinvests installment interest savings immediately", () => {
    const r = simulatePrepaymentVsEtf(
      makeInput({ monthlyAmountCents: 0, oneTimeAmountCents: 2_000_000 }, { repaymentType: "installment", monthlyRateCents: 50_000, specialRepaymentMaxYearlyCents: null }),
    );
    expect(r.prepayment.totalCashOutCents).toBe(r.etf.totalCashOutCents);
    expect(r.prepayment.totalSpecialRepaymentCents).toBeGreaterThan(2_000_000);
  });

  it("charges only interest for lump-sum loans", () => {
    const r = simulatePrepaymentVsEtf(
      makeInput({ oneTimeAmountCents: 0, monthlyAmountCents: 0 }, { repaymentType: "lump_sum" }),
    );
    expect(r.etf.remainingDebtCents).toBe(10_000_000);
    expect(r.etf.totalRegularPaymentCents).toBe(r.etf.totalInterestCents);
    expect(r.etf.totalInterestCents).toBe(60 * 29_167);
  });

  it("flags rate below interest without throwing and grows the debt", () => {
    const r = simulatePrepaymentVsEtf(
      makeInput({ oneTimeAmountCents: 0, monthlyAmountCents: 0 }, { monthlyRateCents: 10_000 }),
    );
    expect(r.flags.rateBelowInterest).toBe(true);
    expect(r.etf.remainingDebtCents).toBeGreaterThan(10_000_000);
  });

  it("handles an elapsed horizon and rejects an overlong one", () => {
    const r = simulatePrepaymentVsEtf(makeInput({ horizonEndDate: "2025-01-01" }));
    expect(r.horizonMonths).toBe(0);
    expect(r.flags.horizonElapsed).toBe(true);
    expect(r.timeline).toHaveLength(1);
    expect(r.netAdvantageEtfCents).toBe(
      r.etf.netWorthCents - r.prepayment.netWorthCents,
    );
    expect(() => simulatePrepaymentVsEtf(makeInput({ horizonEndDate: "2066-02-15" }))).toThrow(RangeError);
    expect(() => simulatePrepaymentVsEtf(makeInput({ horizonEndDate: "2066-01-15" }))).not.toThrow();
  });

  it("builds a monotone timeline of length n + 1", () => {
    const r = simulatePrepaymentVsEtf(makeInput());
    expect(r.timeline).toHaveLength(r.horizonMonths + 1);
    expect(r.horizonMonths).toBe(60);
    for (let i = 1; i < r.timeline.length; i += 1) {
      expect(r.timeline[i]!.date > r.timeline[i - 1]!.date).toBe(true);
    }
    const last = r.timeline.at(-1)!;
    expect(last.netWorthA).toBe(r.prepayment.netWorthCents);
    expect(last.netWorthB).toBe(r.etf.netWorthCents);
  });

  it("yields no ETF value when both amounts are 0", () => {
    const r = simulatePrepaymentVsEtf(makeInput({ oneTimeAmountCents: 0, monthlyAmountCents: 0 }));
    expect(r.netAdvantageEtfCents).toBe(0);
    expect(r.etf.etfGrossCents).toBe(0);
    expect(r.prepayment.etfGrossCents).toBe(0);
  });

  it("is deterministic and produces only safe integers", () => {
    const a = simulatePrepaymentVsEtf(makeInput());
    const b = simulatePrepaymentVsEtf(makeInput());
    expect(a).toEqual(b);
    for (const v of [a.netAdvantageEtfCents, a.prepayment.netWorthCents, a.etf.netWorthCents, a.interestSavedCents]) {
      expect(Number.isSafeInteger(v)).toBe(true);
    }
  });

  it("rejects invalid inputs", () => {
    expect(() => simulatePrepaymentVsEtf(makeInput({ oneTimeAmountCents: -1 }))).toThrow(RangeError);
    expect(() => simulatePrepaymentVsEtf(makeInput({ monthlyAmountCents: 1.5 }))).toThrow(RangeError);
    expect(() => simulatePrepaymentVsEtf(makeInput({}, { interestRateBps: 350.5 }))).toThrow(RangeError);
    expect(() => simulatePrepaymentVsEtf(makeInput({ startDate: "2026-02-30" }))).toThrow(RangeError);
    expect(() => simulatePrepaymentVsEtf(makeInput({ churchTaxBps: 500 as unknown as 0 }))).toThrow(RangeError);
    expect(() => simulatePrepaymentVsEtf(makeInput({ etfAnnualReturnBps: 3001 }))).toThrow(RangeError);
    expect(() => simulatePrepaymentVsEtf(makeInput({ saverAllowanceCents: 200_001 }))).toThrow(RangeError);
  });
});

describe("findBreakEvenReturnBps", () => {
  const withoutReturn = (full: PrepaymentVsEtfInput) => {
    const { etfAnnualReturnBps: _i, ...rest } = full;
    void _i;
    return rest;
  };
  const advantage = (
    rest: ReturnType<typeof withoutReturn>,
    bps: number,
  ): number =>
    simulatePrepaymentVsEtf({ ...rest, etfAnnualReturnBps: bps })
      .netAdvantageEtfCents;

  function expectBreakEvenProperty(rest: ReturnType<typeof withoutReturn>) {
    const be = findBreakEvenReturnBps(rest);
    if (be.kind !== "bps") return be;
    expect(advantage(rest, be.bps)).toBeGreaterThanOrEqual(0);
    if (be.bps > 0) {
      expect(advantage(rest, be.bps - 1)).toBeLessThan(0);
    }
    return be;
  }

  it("returns the smallest bps with advantage >= 0 (3.50 % loan)", () => {
    const rest = withoutReturn(makeInput());
    const be = expectBreakEvenProperty(rest);
    expect(be.kind).toBe("bps");
    if (be.kind === "bps") expect(be.bps).toBeGreaterThan(350);
  });

  it("is 0 bps at 0 % loan interest", () => {
    const rest = withoutReturn(makeInput({}, { interestRateBps: 0 }));
    expect(findBreakEvenReturnBps(rest)).toEqual({ kind: "bps", bps: 0 });
  });

  it("does not report identical when only -50 % returns look equal (regression)", () => {
    const rest = withoutReturn(
      makeInput(
        {
          startDate: "2026-01-31",
          horizonEndDate: "2046-01-31",
          oneTimeAmountCents: 648_896,
          monthlyAmountCents: 115_712,
        },
        {
          balanceCents: 2_168_116,
          interestRateBps: 440,
          monthlyRateCents: 263_712,
          specialRepaymentMaxYearlyCents: 1_507_200,
        },
      ),
    );
    expect(advantage(rest, 0)).toBeLessThan(0);
    const be = expectBreakEvenProperty(rest);
    expect(be.kind).toBe("bps");
    if (be.kind === "bps") expect(be.bps).toBeGreaterThan(0);
  });

  it("is identical for cap 0, zero start debt and an elapsed horizon", () => {
    expect(
      findBreakEvenReturnBps(withoutReturn(makeInput({}, { specialRepaymentMaxYearlyCents: 0 }))),
    ).toEqual({ kind: "identical" });
    expect(
      findBreakEvenReturnBps(withoutReturn(makeInput({}, { balanceCents: 0 }))),
    ).toEqual({ kind: "identical" });
    expect(
      findBreakEvenReturnBps(withoutReturn(makeInput({ horizonEndDate: "2025-01-01" }))),
    ).toEqual({ kind: "identical" });
  });

  it("is identical when both amounts are 0", () => {
    const rest = withoutReturn(makeInput({ oneTimeAmountCents: 0, monthlyAmountCents: 0 }));
    expect(findBreakEvenReturnBps(rest)).toEqual({ kind: "identical" });
  });

  it("is unreachable when the ETF never catches up", () => {
    const rest = withoutReturn(makeInput({}, { interestRateBps: 5000 }));
    expect(findBreakEvenReturnBps(rest)).toEqual({ kind: "unreachable" });
  });

  it("keeps the advantage rising over 0-1000 bps for all repayment types", () => {
    for (const repaymentType of ["annuity", "installment", "lump_sum"] as const) {
      const rest = withoutReturn(makeInput({}, { repaymentType }));
      let previous = Number.NEGATIVE_INFINITY;
      for (let bps = 0; bps <= 1000; bps += 25) {
        const adv = advantage(rest, bps);
        expect(adv).toBeGreaterThan(previous);
        previous = adv;
      }
      expectBreakEvenProperty(rest);
    }
  });
});

describe("buildPrepaymentDefaults", () => {
  const contract: DomainContract & { specialRepaymentMaxYearlyCents?: number | null } = {
    id: "c1",
    name: "Musterbank Annuitätendarlehen",
    category: "loan",
    status: "active",
    currentBalanceCents: 10_000_000,
    balanceAsOfDate: "2026-01-15",
    monthlyRateCents: 60_000,
    interestRateBps: 350,
    repaymentType: "annuity",
    fixedInterestUntil: "2032-01-15",
    specialRepaymentMaxYearlyCents: 500_000,
  };

  it("takes fixed-interest end and cap, with a projected balance", () => {
    const d = buildPrepaymentDefaults(contract, "2026-07-15");
    expect(d.horizonEndDate).toBe("2032-01-15");
    expect(d.horizonEstimated).toBe(false);
    expect(d.capUnknown).toBe(false);
    expect(d.loan.specialRepaymentMaxYearlyCents).toBe(500_000);
    expect(d.loan.balanceCents).toBeLessThan(10_000_000);
    expect(d.startDate).toBe("2026-07-15");
  });

  it("estimates the horizon and flags an unknown cap", () => {
    const d = buildPrepaymentDefaults({ ...contract, fixedInterestUntil: null, specialRepaymentMaxYearlyCents: null }, "2026-07-15");
    expect(d.horizonEndDate).toBe("2036-07-15");
    expect(d.horizonEstimated).toBe(true);
    expect(d.capUnknown).toBe(true);
  });

  it("does not project lump-sum loans and keeps expired fixed-interest dates", () => {
    const d = buildPrepaymentDefaults({ ...contract, repaymentType: "lump_sum", fixedInterestUntil: "2026-03-01" }, "2026-07-15");
    expect(d.loan.balanceCents).toBe(10_000_000);
    expect(d.horizonEndDate).toBe("2026-03-01");
  });

  it("rejects savings contracts", () => {
    expect(() => buildPrepaymentDefaults({ ...contract, category: "savings_contract" }, "2026-07-15")).toThrow(RangeError);
  });
});

function pot(overrides: Partial<DomainPot> & { id: string }): DomainPot {
  return {
    name: overrides.id,
    priority: 1,
    currentCents: 0,
    targetCents: 100_000,
    ruleType: "fill_to_target",
    ...overrides,
  };
}

describe("simulateCashflowChange", () => {
  const pots = [
    pot({ id: "a-notgroschen", name: "Notgroschen", priority: 1, targetCents: 100_000 }),
    pot({ id: "b-ek", name: "Wohnungs-EK", priority: 2, targetCents: 200_000 }),
  ];

  it("fills pots earlier with a raise (exactly computed)", () => {
    const r = simulateCashflowChange({
      startMonth: "2026-12",
      baseMonthlySurplusCents: 50_000,
      change: { effectiveFromMonth: "2027-03", deltaMonthlyCents: 50_000 },
      pots,
      horizonMonths: 24,
    });
    // Baseline: 50k/month -> 300k total needed -> notgroschen month 2, EK month 6.
    // Scenario: months 1-3 (Dec..Feb) 50k = 150k, from month 4 100k/month:
    // notgroschen full month 2; EK needs 200k: 150k-100k=50k to EK by month 3,
    // month 4 +100k=150k, month 5 +100k=250k >= 200k -> month 5.
    const [n, ek] = r.pots;
    expect(n!.baselineMonthsToFill).toBe(2);
    expect(n!.scenarioMonthsToFill).toBe(2);
    expect(n!.monthsGained).toBe(0);
    expect(ek!.baselineMonthsToFill).toBe(6);
    expect(ek!.scenarioMonthsToFill).toBe(5);
    expect(ek!.monthsGained).toBe(1);
    expect(ek!.baselineFillMonth).toBe("2027-05");
    expect(ek!.scenarioFillMonth).toBe("2027-04");
  });

  it("is identical for delta 0", () => {
    const r = simulateCashflowChange({
      startMonth: "2026-12",
      baseMonthlySurplusCents: 50_000,
      change: { effectiveFromMonth: "2027-01", deltaMonthlyCents: 0 },
      pots,
    });
    for (const p of r.pots) {
      expect(p.scenarioMonthsToFill).toBe(p.baselineMonthsToFill);
      expect(p.monthsGained).toBe(0);
    }
  });

  it("delays filling with a negative delta and counts deficit months without withdrawals", () => {
    const r = simulateCashflowChange({
      startMonth: "2026-12",
      baseMonthlySurplusCents: 50_000,
      change: { effectiveFromMonth: "2026-12", deltaMonthlyCents: -20_000 },
      pots,
      horizonMonths: 36,
    });
    expect(r.pots[0]!.monthsGained!).toBeLessThan(0);
    expect(r.scenarioDeficitMonths).toBe(0);

    const deficit = simulateCashflowChange({
      startMonth: "2026-12",
      baseMonthlySurplusCents: 50_000,
      change: { effectiveFromMonth: "2026-12", deltaMonthlyCents: -80_000 },
      pots,
      horizonMonths: 12,
    });
    expect(deficit.scenarioDeficitMonths).toBe(12);
    expect(deficit.baselineDeficitMonths).toBe(0);
    expect(deficit.pots[0]!.scenarioMonthsToFill).toBeNull();
    expect(deficit.scenarioSurplusAfterChangeCents).toBe(-30_000);
  });

  it("reports null for baseline 0 surplus and a finite scenario", () => {
    const r = simulateCashflowChange({
      startMonth: "2026-12",
      baseMonthlySurplusCents: 0,
      change: { effectiveFromMonth: "2026-12", deltaMonthlyCents: 100_000 },
      pots,
      horizonMonths: 24,
    });
    expect(r.pots[0]!.baselineMonthsToFill).toBeNull();
    expect(r.pots[0]!.scenarioMonthsToFill).toBe(1);
    expect(r.pots[0]!.monthsGained).toBeNull();
  });

  it("marks already filled pots and pots without target", () => {
    const r = simulateCashflowChange({
      startMonth: "2026-12",
      baseMonthlySurplusCents: 50_000,
      change: { effectiveFromMonth: "2026-12", deltaMonthlyCents: 0 },
      pots: [
        pot({ id: "full", currentCents: 100_000, targetCents: 100_000 }),
        pot({ id: "free", targetCents: null, ruleType: "percentage_of_remainder", remainderPercentage: 50, priority: 3 }),
      ],
    });
    const full = r.pots.find((p) => p.potId === "full")!;
    expect(full.alreadyFilled).toBe(true);
    expect(full.baselineMonthsToFill).toBe(0);
    const free = r.pots.find((p) => p.potId === "free")!;
    expect(free.hasTarget).toBe(false);
    expect(free.baselineMonthsToFill).toBeNull();
    expect(free.scenarioMonthsToFill).toBeNull();
  });

  it("honors waterfall priority with fixed_monthly pots ahead of the target pot", () => {
    const r = simulateCashflowChange({
      startMonth: "2026-12",
      baseMonthlySurplusCents: 100_000,
      change: { effectiveFromMonth: "2026-12", deltaMonthlyCents: 0 },
      pots: [
        pot({ id: "fix", priority: 1, ruleType: "fixed_monthly", fixedMonthlyCents: 60_000, targetCents: null }),
        pot({ id: "goal", priority: 2, targetCents: 120_000 }),
      ],
    });
    // 40k/month remain for goal -> 3 months.
    expect(r.pots.find((p) => p.potId === "goal")!.baselineMonthsToFill).toBe(3);
  });

  it("applies effectiveFromMonth before startMonth from month 1 and ignores one after the horizon", () => {
    const early = simulateCashflowChange({
      startMonth: "2026-12",
      baseMonthlySurplusCents: 50_000,
      change: { effectiveFromMonth: "2020-01", deltaMonthlyCents: 50_000 },
      pots,
      horizonMonths: 12,
    });
    const atStart = simulateCashflowChange({
      startMonth: "2026-12",
      baseMonthlySurplusCents: 50_000,
      change: { effectiveFromMonth: "2026-12", deltaMonthlyCents: 50_000 },
      pots,
      horizonMonths: 12,
    });
    expect(early).toEqual(atStart);

    const late = simulateCashflowChange({
      startMonth: "2026-12",
      baseMonthlySurplusCents: 50_000,
      change: { effectiveFromMonth: "2040-01", deltaMonthlyCents: 50_000 },
      pots,
      horizonMonths: 12,
    });
    for (const p of late.pots) expect(p.monthsGained === 0 || p.monthsGained === null).toBe(true);
  });

  it("does not mutate the input pots", () => {
    const copy = structuredClone(pots);
    simulateCashflowChange({
      startMonth: "2026-12",
      baseMonthlySurplusCents: 50_000,
      change: { effectiveFromMonth: "2027-01", deltaMonthlyCents: 10_000 },
      pots,
    });
    expect(pots).toEqual(copy);
  });

  it("fills in exactly the month when headroom equals the surplus", () => {
    const r = simulateCashflowChange({
      startMonth: "2026-12",
      baseMonthlySurplusCents: 100_000,
      change: { effectiveFromMonth: "2026-12", deltaMonthlyCents: 0 },
      pots: [pot({ id: "x", targetCents: 100_000 })],
    });
    expect(r.pots[0]!.baselineMonthsToFill).toBe(1);
    expect(r.pots[0]!.baselineFillMonth).toBe("2026-12");
  });

  it("rejects invalid inputs", () => {
    const base = {
      startMonth: "2026-12",
      baseMonthlySurplusCents: 1,
      change: { effectiveFromMonth: "2026-12", deltaMonthlyCents: 0 },
      pots,
    };
    expect(() => simulateCashflowChange({ ...base, horizonMonths: 0 })).toThrow(RangeError);
    expect(() => simulateCashflowChange({ ...base, horizonMonths: 481 })).toThrow(RangeError);
    expect(() => simulateCashflowChange({ ...base, startMonth: "2026-13" })).toThrow(RangeError);
    expect(() => simulateCashflowChange({ ...base, baseMonthlySurplusCents: 1.5 })).toThrow(RangeError);
    expect(() => simulateCashflowChange({ ...base, pots: [pot({ id: "d" }), pot({ id: "d" })] })).toThrow(RangeError);
  });
});
