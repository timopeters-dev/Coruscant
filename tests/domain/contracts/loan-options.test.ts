import { describe, expect, it } from "vitest";
import { contractRecordToDomain, type DomainContract, validateContract } from "@/domain/contracts/contract";
import { annuityRateFromRepaymentBps, DEFAULT_RATE_CHANGE_MAX_REPAYMENT_BPS, DEFAULT_RATE_CHANGE_MIN_REPAYMENT_BPS, getLoanOptions, installmentRateFromRepaymentBps, repaymentBpsFromRate } from "@/domain/contracts/loan-options";
import { remainingSpecialRepaymentCents, resolveRateCorridor, resolveYearlyCapCents, specialRepaymentRule } from "@/domain/contracts/loan-allowances";
import { validateLoanOptions } from "@/domain/contracts/loan-options-validation";

function makeLoan(overrides: Partial<DomainContract> = {}): DomainContract {
  return {
    id: "loan-muster-1",
    name: "Hauskredit Musterstraße 1",
    category: "loan",
    status: "active",
    currentBalanceCents: 20_000_000, // 200.000 €
    balanceAsOfDate: "2026-01-01",
    monthlyRateCents: 110_000, // 1.100 €
    interestRateBps: 350, // 3,50 %
    repaymentType: "annuity",
    fixedInterestUntil: "2036-01-01",
    ...overrides,
  };
}

describe("getLoanOptions (legacy backward compatibility)", () => {
  it("derives unknown / none / allowed fixed_yearly when specialRepaymentRight is absent", () => {
    const unknown = getLoanOptions(
      makeLoan({ specialRepaymentMaxYearlyCents: null }),
    );
    expect(unknown.specialRepaymentRight).toBe("unknown");
    expect(unknown.specialRepaymentBasis).toBeNull();
    expect(unknown.specialRepaymentMaxYearlyCents).toBeNull();

    const none = getLoanOptions(makeLoan({ specialRepaymentMaxYearlyCents: 0 }));
    expect(none.specialRepaymentRight).toBe("none");
    expect(none.specialRepaymentBasis).toBeNull();
    expect(none.specialRepaymentMaxYearlyCents).toBeNull();

    const allowed = getLoanOptions(
      makeLoan({ specialRepaymentMaxYearlyCents: 1_000_000 }),
    );
    expect(allowed.specialRepaymentRight).toBe("allowed");
    expect(allowed.specialRepaymentBasis).toBe("fixed_yearly");
    expect(allowed.specialRepaymentMaxYearlyCents).toBe(1_000_000);
  });
});

describe("specialRepaymentRule & resolveYearlyCapCents", () => {
  it("handles fixed cap", () => {
    const loan = makeLoan({
      specialRepaymentRight: "allowed",
      specialRepaymentBasis: "fixed_yearly",
      specialRepaymentMaxYearlyCents: 1_250_000,
    });
    const rule = specialRepaymentRule(loan);
    expect(rule).toEqual({ kind: "fixed", capCents: 1_250_000 });
    expect(resolveYearlyCapCents(rule, 20_000_000)).toBe(1_250_000);
  });

  it("handles percent_original with floor rounding and missing original principal", () => {
    // 333_333 cents * 500 bps / 10_000 = 16_666.65 -> floor = 16_666
    const loan = makeLoan({
      originalPrincipalCents: 333_333,
      specialRepaymentRight: "allowed",
      specialRepaymentBasis: "percent_original",
      specialRepaymentPercentBps: 500,
    });
    const rule = specialRepaymentRule(loan);
    expect(rule).toEqual({ kind: "fixed", capCents: 16_666 });
    expect(resolveYearlyCapCents(rule, 200_000)).toBe(16_666);

    const missingOrig = makeLoan({
      originalPrincipalCents: null,
      specialRepaymentRight: "allowed",
      specialRepaymentBasis: "percent_original",
      specialRepaymentPercentBps: 500,
    });
    const missingRule = specialRepaymentRule(missingOrig);
    expect(missingRule).toEqual({
      kind: "allowed_unknown_amount",
      missingOriginalPrincipal: true,
    });
    expect(resolveYearlyCapCents(missingRule, 20_000_000)).toBeNull();
  });

  it("handles percent_balance including 0 balance, 10000 bps (100%), and MAX_SAFE_INTEGER-scale BigInt", () => {
    const rule5 = specialRepaymentRule(
      makeLoan({
        specialRepaymentRight: "allowed",
        specialRepaymentBasis: "percent_balance",
        specialRepaymentPercentBps: 500,
      }),
    );
    expect(rule5).toEqual({ kind: "percent_balance", bps: 500 });
    expect(resolveYearlyCapCents(rule5, 0)).toBe(0);
    expect(resolveYearlyCapCents(rule5, 333_333)).toBe(16_666); // floor

    const rule100 = { kind: "percent_balance" as const, bps: 10_000 };
    expect(resolveYearlyCapCents(rule100, 12_345_678)).toBe(12_345_678);

    // Near MAX_SAFE_INTEGER: BigInt prevents float overflow
    const huge = Number.MAX_SAFE_INTEGER - 7;
    const capHuge = resolveYearlyCapCents(
      { kind: "percent_balance", bps: 500 },
      huge,
    );
    expect(capHuge).toBe(Number((BigInt(huge) * 500n) / 10_000n));
  });

  it("returns 0 for none and null for unknown / allowed_unknown_amount", () => {
    expect(resolveYearlyCapCents({ kind: "none" }, 20_000_000)).toBe(0);
    expect(resolveYearlyCapCents({ kind: "unknown" }, 20_000_000)).toBeNull();
    expect(
      resolveYearlyCapCents(
        { kind: "allowed_unknown_amount", missingOriginalPrincipal: false },
        20_000_000,
      ),
    ).toBeNull();
  });
});

describe("remainingSpecialRepaymentCents", () => {
  it("subtracts same-year usage, clamps at 0, and resets usage from prior year with flag", () => {
    const base = makeLoan({
      specialRepaymentRight: "allowed",
      specialRepaymentBasis: "fixed_yearly",
      specialRepaymentMaxYearlyCents: 1_000_000,
      specialRepaymentUsedCents: 300_000,
      specialRepaymentUsedYear: 2026,
    });

    const sameYear = remainingSpecialRepaymentCents(base, "2026-11-19", 20_000_000);
    expect(sameYear.capCents).toBe(1_000_000);
    expect(sameYear.usedCents).toBe(300_000);
    expect(sameYear.remainingCents).toBe(700_000);
    expect(sameYear.flags.usageFromOtherYear).toBe(false);

    const nextYear = remainingSpecialRepaymentCents(base, "2027-01-15", 19_000_000);
    expect(nextYear.usedCents).toBe(0);
    expect(nextYear.remainingCents).toBe(1_000_000);
    expect(nextYear.flags.usageFromOtherYear).toBe(true);

    const overUsed = remainingSpecialRepaymentCents(
      makeLoan({
        specialRepaymentRight: "allowed",
        specialRepaymentBasis: "fixed_yearly",
        specialRepaymentMaxYearlyCents: 1_000_000,
        specialRepaymentUsedCents: 1_500_000,
        specialRepaymentUsedYear: 2026,
      }),
      "2026-11-19",
      20_000_000,
    );
    expect(overUsed.remainingCents).toBe(0);
  });

  it("handles none (0) and unknown (null)", () => {
    const none = remainingSpecialRepaymentCents(
      makeLoan({ specialRepaymentRight: "none" }),
      "2026-11-19",
    );
    expect(none.capCents).toBe(0);
    expect(none.remainingCents).toBe(0);
    expect(none.flags.capUnknown).toBe(false);

    const unknown = remainingSpecialRepaymentCents(
      makeLoan({ specialRepaymentRight: "unknown" }),
      "2026-11-19",
    );
    expect(unknown.capCents).toBeNull();
    expect(unknown.remainingCents).toBeNull();
    expect(unknown.flags.capUnknown).toBe(true);
  });
});

describe("rate conversion functions", () => {
  it("computes annuity rate with half-up rounding and handles 0/0 edge case", () => {
    expect(annuityRateFromRepaymentBps(20_000_000, 0, 0)).toBe(0);
    expect(annuityRateFromRepaymentBps(0, 350, 200)).toBe(0);
    // 24_000_000 * (350 + 250) / 120_000 = 120_000 cents (1.200 €)
    expect(annuityRateFromRepaymentBps(24_000_000, 350, 250)).toBe(120_000);
    // Half-up at .5 cent boundary: 60_000 * 1 / 120_000 = 0.5 -> 1 cent
    expect(annuityRateFromRepaymentBps(60_000, 0, 1)).toBe(1);
    // Below .5 cent: 59_999 * 1 / 120_000 < 0.5 -> 0 cent
    expect(annuityRateFromRepaymentBps(59_999, 0, 1)).toBe(0);
  });

  it("computes installment rate and round-trips via repaymentBpsFromRate within ±1 bps", () => {
    // 24_000_000 * 500 / 120_000 = 100_000 cents (1.000 €)
    expect(installmentRateFromRepaymentBps(24_000_000, 500)).toBe(100_000);

    const annuityLoan = makeLoan({
      originalPrincipalCents: 25_000_000,
      interestRateBps: 380,
    });
    const rate = annuityRateFromRepaymentBps(25_000_000, 380, 275);
    const back = repaymentBpsFromRate(annuityLoan, rate);
    expect(back).not.toBeNull();
    expect(back!.approximated).toBe(false);
    expect(Math.abs(back!.bps - 275)).toBeLessThanOrEqual(1);

    const instLoan = makeLoan({
      repaymentType: "installment",
      originalPrincipalCents: null,
      currentBalanceCents: 18_000_000,
    });
    const instRate = installmentRateFromRepaymentBps(18_000_000, 420);
    const instBack = repaymentBpsFromRate(instLoan, instRate);
    expect(instBack).not.toBeNull();
    expect(instBack!.approximated).toBe(true);
    expect(Math.abs(instBack!.bps - 420)).toBeLessThanOrEqual(1);

    // lump_sum returns null
    expect(
      repaymentBpsFromRate(makeLoan({ repaymentType: "lump_sum" }), 100_000),
    ).toBeNull();
  });
});

describe("resolveRateCorridor", () => {
  it("returns not_applicable for lump_sum and savings_contract, none for rateChangeRight=none", () => {
    expect(
      resolveRateCorridor(makeLoan({ repaymentType: "lump_sum" }), "2026-11-19")
        .status,
    ).toBe("not_applicable");
    expect(
      resolveRateCorridor(
        makeLoan({ category: "savings_contract", repaymentType: null }),
        "2026-11-19",
      ).status,
    ).toBe("not_applicable");

    const none = resolveRateCorridor(
      makeLoan({ rateChangeRight: "none" }),
      "2026-11-19",
    );
    expect(none.status).toBe("none");
    expect(none.minMonthlyCents).toBeNull();
    expect(none.maxMonthlyCents).toBeNull();
    expect(none.remainingChanges).toBe(0);
  });

  it("uses assumed 1-10% corridor for unknown right with approximatedBase when originalPrincipalCents is missing", () => {
    const loan = makeLoan({
      originalPrincipalCents: null,
      currentBalanceCents: 24_000_000,
      interestRateBps: 300,
      rateChangeRight: "unknown",
    });
    const corridor = resolveRateCorridor(loan, "2026-11-19");
    expect(corridor.status).toBe("unknown");
    expect(corridor.flags.corridorAssumed).toBe(true);
    expect(corridor.flags.approximatedBase).toBe(true);
    expect(corridor.minMonthlyCents).toBe(
      annuityRateFromRepaymentBps(
        24_000_000,
        300,
        DEFAULT_RATE_CHANGE_MIN_REPAYMENT_BPS,
      ),
    );
    expect(corridor.maxMonthlyCents).toBe(
      annuityRateFromRepaymentBps(
        24_000_000,
        300,
        DEFAULT_RATE_CHANGE_MAX_REPAYMENT_BPS,
      ),
    );
  });

  it("computes corridor from bps only, cents only, intersection of both, and min === max", () => {
    const base = {
      originalPrincipalCents: 24_000_000,
      interestRateBps: 300,
      rateChangeRight: "allowed" as const,
      monthlyRateCents: 120_000,
    };

    // bps only: 1%..5% -> 80_000..160_000
    const bpsOnly = resolveRateCorridor(
      makeLoan({
        ...base,
        rateChangeMinRepaymentBps: 100,
        rateChangeMaxRepaymentBps: 500,
      }),
      "2026-11-19",
    );
    expect(bpsOnly.minMonthlyCents).toBe(80_000);
    expect(bpsOnly.maxMonthlyCents).toBe(160_000);
    expect(bpsOnly.flags.corridorAssumed).toBe(false);
    expect(bpsOnly.flags.approximatedBase).toBe(false);

    // cents only
    const centsOnly = resolveRateCorridor(
      makeLoan({
        ...base,
        originalPrincipalCents: null,
        rateChangeMinMonthlyCents: 90_000,
        rateChangeMaxMonthlyCents: 150_000,
      }),
      "2026-11-19",
    );
    expect(centsOnly.minMonthlyCents).toBe(90_000);
    expect(centsOnly.maxMonthlyCents).toBe(150_000);
    expect(centsOnly.flags.approximatedBase).toBe(false);

    // intersection of bps (80k..160k) and cents (95k..140k) -> 95k..140k
    const both = resolveRateCorridor(
      makeLoan({
        ...base,
        rateChangeMinRepaymentBps: 100,
        rateChangeMaxRepaymentBps: 500,
        rateChangeMinMonthlyCents: 95_000,
        rateChangeMaxMonthlyCents: 140_000,
      }),
      "2026-11-19",
    );
    expect(both.minMonthlyCents).toBe(95_000);
    expect(both.maxMonthlyCents).toBe(140_000);

    // min === max
    const exact = resolveRateCorridor(
      makeLoan({
        ...base,
        rateChangeMinMonthlyCents: 120_000,
        rateChangeMaxMonthlyCents: 120_000,
      }),
      "2026-11-19",
    );
    expect(exact.minMonthlyCents).toBe(120_000);
    expect(exact.maxMonthlyCents).toBe(120_000);
  });

  it("flags currentOutsideCorridor, minBelowInterest, exhausted, per_year, and fixed_period without date", () => {
    const loan = makeLoan({
      currentBalanceCents: 24_000_000,
      originalPrincipalCents: 24_000_000,
      interestRateBps: 300, // monthly interest = 60_000
      monthlyRateCents: 200_000,
      rateChangeRight: "allowed",
      rateChangeTotalCount: 2,
      rateChangeUsedCount: 2,
      rateChangeScope: "fixed_period",
      fixedInterestUntil: null,
      rateChangeMinMonthlyCents: 50_000, // below monthly interest 60_000
      rateChangeMaxMonthlyCents: 150_000, // below current 200_000
    });
    const corridor = resolveRateCorridor(loan, "2026-11-19");
    expect(corridor.flags.currentOutsideCorridor).toBe(true);
    expect(corridor.flags.minBelowInterest).toBe(true);
    expect(corridor.sliderMinMonthlyCents).toBe(60_001);
    expect(corridor.flags.exhausted).toBe(true);
    expect(corridor.remainingChanges).toBe(0);
    expect(corridor.latestChangeDate).toBeNull();

    const perYear = resolveRateCorridor(
      makeLoan({
        rateChangeRight: "allowed",
        rateChangeTotalCount: 2,
        rateChangeUsedCount: 2,
        rateChangeScope: "per_year",
        rateChangeMinMonthlyCents: 80_000,
        rateChangeMaxMonthlyCents: 160_000,
      }),
      "2026-11-19",
    );
    expect(perYear.flags.perYearUsageUntracked).toBe(true);
    expect(perYear.flags.exhausted).toBe(false);
    expect(perYear.remainingChanges).toBe(2);
  });
});

describe("validateLoanOptions & contractRecordToDomain", () => {
  it("rejects empty corridor intersection, used > total, invalid percent_bps, missing basis value, negative values, count 51", () => {
    const baseOptions = getLoanOptions(
      makeLoan({
        originalPrincipalCents: 24_000_000,
        rateChangeRight: "allowed",
      }),
    );

    // Empty intersection: bps 5%..6% (at 3% interest -> 160k..180k) vs cents 80k..120k
    expect(() =>
      validateLoanOptions(
        {
          ...baseOptions,
          rateChangeMinRepaymentBps: 500,
          rateChangeMaxRepaymentBps: 600,
          rateChangeMinMonthlyCents: 80_000,
          rateChangeMaxMonthlyCents: 120_000,
        },
        { interestRateBps: 300, currentBalanceCents: 24_000_000, repaymentType: "annuity" },
      ),
    ).toThrow(RangeError);

    // used_count > total_count
    expect(() =>
      validateLoanOptions({
        ...baseOptions,
        rateChangeTotalCount: 2,
        rateChangeUsedCount: 3,
        rateChangeScope: "term",
      }),
    ).toThrow(RangeError);

    // percent_bps = 0 or > 10000
    expect(() =>
      validateLoanOptions({
        ...baseOptions,
        specialRepaymentRight: "allowed",
        specialRepaymentBasis: "percent_balance",
        specialRepaymentPercentBps: 0,
      }),
    ).toThrow(RangeError);
    expect(() =>
      validateLoanOptions({
        ...baseOptions,
        specialRepaymentRight: "allowed",
        specialRepaymentBasis: "percent_balance",
        specialRepaymentPercentBps: 10_001,
      }),
    ).toThrow(RangeError);

    // Basis without value
    expect(() =>
      validateLoanOptions({
        ...baseOptions,
        specialRepaymentRight: "allowed",
        specialRepaymentBasis: "fixed_yearly",
        specialRepaymentMaxYearlyCents: null,
      }),
    ).toThrow(RangeError);
    expect(() =>
      validateLoanOptions({
        ...baseOptions,
        specialRepaymentRight: "allowed",
        specialRepaymentBasis: "percent_original",
        specialRepaymentPercentBps: null,
      }),
    ).toThrow(RangeError);

    // Negative values
    expect(() =>
      validateLoanOptions({
        ...baseOptions,
        rateChangeMinMonthlyCents: -1,
      }),
    ).toThrow(RangeError);

    // Count 51
    expect(() =>
      validateLoanOptions({
        ...baseOptions,
        rateChangeTotalCount: 51,
      }),
    ).toThrow(RangeError);
  });

  it("maps record via contractRecordToDomain and validates loans via validateContract", () => {
    const domain = contractRecordToDomain(
      makeLoan({
        originalPrincipalCents: 25_000_000,
        specialRepaymentRight: "allowed",
        specialRepaymentBasis: "percent_original",
        specialRepaymentPercentBps: 500,
      }),
    );
    expect(domain.originalPrincipalCents).toBe(25_000_000);
    expect(() => validateContract(domain)).not.toThrow();

    // validateContract skips loan option validation for savings_contract
    const savings = contractRecordToDomain(
      makeLoan({
        category: "savings_contract",
        repaymentType: null,
        rateChangeTotalCount: 51,
      }),
    );
    expect(() => validateContract(savings)).not.toThrow();
  });

  it("returns corridorEmpty without throwing when approximated balance makes bps+cents intersection empty after calibration", () => {
    const calibrated = makeLoan({
      originalPrincipalCents: null,
      currentBalanceCents: 15_000_000, // 150.000 € after calibration
      interestRateBps: 380,
      monthlyRateCents: 120_000,
      rateChangeRight: "allowed",
      rateChangeTotalCount: 2,
      rateChangeScope: "fixed_period",
      rateChangeMinRepaymentBps: 100,
      rateChangeMaxRepaymentBps: 300, // at 150k & 3,8%: max = 85.000 Cent (850 €)
      rateChangeMinMonthlyCents: 100_000, // 1.000 € > 850 € -> empty intersection
      rateChangeMaxMonthlyCents: 160_000,
    });

    expect(() => validateContract(calibrated)).not.toThrow();
    const corridor = resolveRateCorridor(calibrated, "2026-11-19");
    expect(corridor.flags.corridorEmpty).toBe(true);
    expect(corridor.minMonthlyCents).toBe(120_000);
    expect(corridor.maxMonthlyCents).toBe(120_000);
    expect(corridor.sliderMinMonthlyCents).toBe(120_000);
  });
});
