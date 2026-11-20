import type { ContractCategory, DomainContract, RepaymentType } from "./contract";
import { parseIsoDate } from "@/domain/core/date";
import {
  assertNonNegativeInteger,
  assertSafeInteger,
  roundHalfUpBigInt,
} from "@/domain/core/money";

export type OptionRight = "unknown" | "none" | "allowed";
export type SpecialRepaymentBasis =
  | "fixed_yearly"
  | "percent_original"
  | "percent_balance";
export type RateChangeScope = "term" | "fixed_period" | "per_year";

export const DEFAULT_RATE_CHANGE_MIN_REPAYMENT_BPS = 100;
export const DEFAULT_RATE_CHANGE_MAX_REPAYMENT_BPS = 1000;
export const MAX_RATE_CHANGE_COUNT = 50;

const BPS_DENOMINATOR = 10_000n;
const MONTHS_PER_YEAR_IN_BPS_DENOMINATOR = 120_000n;

export interface LoanOptions {
  originalPrincipalCents: number | null;
  specialRepaymentRight: OptionRight;
  specialRepaymentBasis: SpecialRepaymentBasis | null;
  specialRepaymentMaxYearlyCents: number | null;
  specialRepaymentPercentBps: number | null;
  specialRepaymentUsedCents: number | null;
  specialRepaymentUsedYear: number | null;
  rateChangeRight: OptionRight;
  rateChangeTotalCount: number | null;
  rateChangeScope: RateChangeScope | null;
  rateChangeUsedCount: number;
  rateChangeMinRepaymentBps: number | null;
  rateChangeMaxRepaymentBps: number | null;
  rateChangeMinMonthlyCents: number | null;
  rateChangeMaxMonthlyCents: number | null;
  loanOptionsNote: string | null;
}

export type SpecialRepaymentRule =
  | { kind: "none" }
  | { kind: "unknown" }
  | { kind: "allowed_unknown_amount"; missingOriginalPrincipal: boolean }
  | { kind: "fixed"; capCents: number }
  | { kind: "percent_balance"; bps: number };

export interface SpecialRepaymentAllowance {
  status: OptionRight;
  rule: SpecialRepaymentRule;
  basis: SpecialRepaymentBasis | null;
  percentBps: number | null;
  capCents: number | null;
  usedCents: number;
  usedYear: number | null;
  remainingCents: number | null;
  flags: {
    capUnknown: boolean;
    missingOriginalPrincipal: boolean;
    usageFromOtherYear: boolean;
  };
}

export interface RateCorridor {
  status: "none" | "unknown" | "allowed" | "not_applicable";
  currentMonthlyCents: number;
  minMonthlyCents: number | null;
  maxMonthlyCents: number | null;
  sliderMinMonthlyCents: number | null;
  monthlyInterestCents: number;
  remainingChanges: number | null;
  latestChangeDate: string | null;
  minRepaymentBps: number | null;
  maxRepaymentBps: number | null;
  flags: {
    corridorAssumed: boolean;
    approximatedBase: boolean;
    currentOutsideCorridor: boolean;
    minBelowInterest: boolean;
    perYearUsageUntracked: boolean;
    exhausted: boolean;
    corridorEmpty: boolean;
  };
}

export interface LoanOptionsValidationContext {
  category?: ContractCategory;
  repaymentType?: RepaymentType | null;
  currentBalanceCents?: number;
  interestRateBps?: number;
}

/**
 * Extracts normalized LoanOptions from a DomainContract.
 * Backward compatible: if specialRepaymentRight is omitted, derives it from
 * specialRepaymentMaxYearlyCents (null -> unknown, 0 -> none, >0 -> allowed/fixed_yearly).
 */
export function getLoanOptions(contract: DomainContract): LoanOptions {
  let specialRepaymentRight: OptionRight;
  let specialRepaymentBasis: SpecialRepaymentBasis | null;
  let specialRepaymentMaxYearlyCents: number | null;
  let specialRepaymentPercentBps: number | null;

  if (contract.specialRepaymentRight != null) {
    specialRepaymentRight = contract.specialRepaymentRight;
    specialRepaymentBasis = contract.specialRepaymentBasis ?? null;
    specialRepaymentMaxYearlyCents =
      contract.specialRepaymentMaxYearlyCents ?? null;
    specialRepaymentPercentBps = contract.specialRepaymentPercentBps ?? null;
  } else {
    const legacyCap = contract.specialRepaymentMaxYearlyCents;
    if (legacyCap == null) {
      specialRepaymentRight = "unknown";
      specialRepaymentBasis = null;
      specialRepaymentMaxYearlyCents = null;
      specialRepaymentPercentBps = null;
    } else if (legacyCap === 0) {
      specialRepaymentRight = "none";
      specialRepaymentBasis = null;
      specialRepaymentMaxYearlyCents = null;
      specialRepaymentPercentBps = null;
    } else {
      specialRepaymentRight = "allowed";
      specialRepaymentBasis = contract.specialRepaymentBasis ?? "fixed_yearly";
      specialRepaymentMaxYearlyCents = legacyCap;
      specialRepaymentPercentBps = contract.specialRepaymentPercentBps ?? null;
    }
  }

  return {
    originalPrincipalCents: contract.originalPrincipalCents ?? null,
    specialRepaymentRight,
    specialRepaymentBasis,
    specialRepaymentMaxYearlyCents,
    specialRepaymentPercentBps,
    specialRepaymentUsedCents: contract.specialRepaymentUsedCents ?? null,
    specialRepaymentUsedYear: contract.specialRepaymentUsedYear ?? null,
    rateChangeRight: contract.rateChangeRight ?? "unknown",
    rateChangeTotalCount: contract.rateChangeTotalCount ?? null,
    rateChangeScope: contract.rateChangeScope ?? null,
    rateChangeUsedCount: contract.rateChangeUsedCount ?? 0,
    rateChangeMinRepaymentBps: contract.rateChangeMinRepaymentBps ?? null,
    rateChangeMaxRepaymentBps: contract.rateChangeMaxRepaymentBps ?? null,
    rateChangeMinMonthlyCents: contract.rateChangeMinMonthlyCents ?? null,
    rateChangeMaxMonthlyCents: contract.rateChangeMaxMonthlyCents ?? null,
    loanOptionsNote: contract.loanOptionsNote ?? null,
  };
}

/**
 * Computes monthly annuity rate in cents:
 * roundHalfUp(principalCents * (interestRateBps + repaymentBps) / 120_000).
 */
export function annuityRateFromRepaymentBps(
  principalCents: number,
  interestRateBps: number,
  repaymentBps: number,
): number {
  const safePrincipal = assertNonNegativeInteger(
    principalCents,
    "principalCents",
  );
  const safeInterest = assertNonNegativeInteger(
    interestRateBps,
    "interestRateBps",
  );
  const safeRepayment = assertNonNegativeInteger(repaymentBps, "repaymentBps");
  if (safeRepayment > 10_000) {
    throw new RangeError(
      `repaymentBps must be <= 10000, received: ${safeRepayment}`,
    );
  }
  if (safePrincipal === 0 || safeInterest + safeRepayment === 0) {
    return 0;
  }
  const rate = roundHalfUpBigInt(
    BigInt(safePrincipal) * BigInt(safeInterest + safeRepayment),
    MONTHS_PER_YEAR_IN_BPS_DENOMINATOR,
  );
  return assertSafeInteger(Number(rate), "monthlyRateCents");
}

/**
 * Computes monthly installment principal rate in cents:
 * roundHalfUp(principalCents * repaymentBps / 120_000).
 */
export function installmentRateFromRepaymentBps(
  principalCents: number,
  repaymentBps: number,
): number {
  const safePrincipal = assertNonNegativeInteger(
    principalCents,
    "principalCents",
  );
  const safeRepayment = assertNonNegativeInteger(repaymentBps, "repaymentBps");
  if (safeRepayment > 10_000) {
    throw new RangeError(
      `repaymentBps must be <= 10000, received: ${safeRepayment}`,
    );
  }
  if (safePrincipal === 0 || safeRepayment === 0) {
    return 0;
  }
  const rate = roundHalfUpBigInt(
    BigInt(safePrincipal) * BigInt(safeRepayment),
    MONTHS_PER_YEAR_IN_BPS_DENOMINATOR,
  );
  return assertSafeInteger(Number(rate), "monthlyRateCents");
}

/**
 * Inverse mapping: derives implied repayment rate in bps from a monthly rate in cents.
 * Returns null for non-loans, lump_sum loans, or zero principal base.
 */
export function repaymentBpsFromRate(
  contract: Pick<
    DomainContract,
    | "category"
    | "repaymentType"
    | "originalPrincipalCents"
    | "currentBalanceCents"
    | "interestRateBps"
  >,
  monthlyRateCents: number,
): { bps: number; approximated: boolean } | null {
  const safeRate = assertNonNegativeInteger(
    monthlyRateCents,
    "monthlyRateCents",
  );
  if (contract.category !== "loan" || contract.repaymentType === "lump_sum") {
    return null;
  }

  const approximated = contract.originalPrincipalCents == null;
  const baseCents =
    contract.originalPrincipalCents ?? contract.currentBalanceCents;
  if (baseCents <= 0) {
    return null;
  }

  const totalBps = Number(
    roundHalfUpBigInt(
      BigInt(safeRate) * MONTHS_PER_YEAR_IN_BPS_DENOMINATOR,
      BigInt(baseCents),
    ),
  );

  if (contract.repaymentType === "installment") {
    return {
      bps: assertSafeInteger(totalBps, "repaymentBps"),
      approximated,
    };
  }

  const repaymentBps = totalBps - contract.interestRateBps;
  return {
    bps: assertSafeInteger(repaymentBps, "repaymentBps"),
    approximated,
  };
}

function assertBpsRange(
  value: number,
  fieldName: string,
  minValue = 0,
): number {
  const safe = assertSafeInteger(value, fieldName);
  if (safe < minValue || safe > 10_000) {
    throw new RangeError(
      `${fieldName} must be between ${minValue} and 10000, received: ${safe}`,
    );
  }
  return safe;
}

/**
 * Validates LoanOptions for internal consistency. Throws RangeError on invalid combinations.
 */
export function validateLoanOptions(
  o: LoanOptions,
  context?: LoanOptionsValidationContext,
): void {
  if (o.originalPrincipalCents !== null) {
    const orig = assertSafeInteger(
      o.originalPrincipalCents,
      "originalPrincipalCents",
    );
    if (orig <= 0) {
      throw new RangeError(
        `originalPrincipalCents must be positive, received: ${orig}`,
      );
    }
  }

  if (o.specialRepaymentMaxYearlyCents !== null) {
    assertNonNegativeInteger(
      o.specialRepaymentMaxYearlyCents,
      "specialRepaymentMaxYearlyCents",
    );
  }

  if (o.specialRepaymentPercentBps !== null) {
    assertBpsRange(o.specialRepaymentPercentBps, "specialRepaymentPercentBps", 1);
  }

  const hasUsedCents = o.specialRepaymentUsedCents !== null;
  const hasUsedYear = o.specialRepaymentUsedYear !== null;
  if (hasUsedCents !== hasUsedYear) {
    throw new RangeError(
      "specialRepaymentUsedCents and specialRepaymentUsedYear must both be set or both null",
    );
  }
  if (o.specialRepaymentUsedCents !== null) {
    assertNonNegativeInteger(
      o.specialRepaymentUsedCents,
      "specialRepaymentUsedCents",
    );
  }
  if (o.specialRepaymentUsedYear !== null) {
    const year = assertSafeInteger(
      o.specialRepaymentUsedYear,
      "specialRepaymentUsedYear",
    );
    if (year < 1900 || year > 2200) {
      throw new RangeError(
        `specialRepaymentUsedYear out of range: ${year}`,
      );
    }
  }

  if (o.specialRepaymentRight === "allowed") {
    if (o.specialRepaymentBasis === "fixed_yearly") {
      if (
        o.specialRepaymentMaxYearlyCents === null ||
        o.specialRepaymentMaxYearlyCents <= 0
      ) {
        throw new RangeError(
          "specialRepaymentMaxYearlyCents must be > 0 when specialRepaymentBasis is fixed_yearly",
        );
      }
      if (o.specialRepaymentPercentBps !== null) {
        throw new RangeError(
          "specialRepaymentPercentBps must be null when specialRepaymentBasis is fixed_yearly",
        );
      }
    } else if (
      o.specialRepaymentBasis === "percent_original" ||
      o.specialRepaymentBasis === "percent_balance"
    ) {
      if (o.specialRepaymentPercentBps === null) {
        throw new RangeError(
          `specialRepaymentPercentBps is required when specialRepaymentBasis is ${o.specialRepaymentBasis}`,
        );
      }
      if (o.specialRepaymentMaxYearlyCents !== null) {
        throw new RangeError(
          "specialRepaymentMaxYearlyCents must be null when specialRepaymentBasis is percentage-based",
        );
      }
    }
  }

  if (o.rateChangeTotalCount !== null) {
    const count = assertSafeInteger(
      o.rateChangeTotalCount,
      "rateChangeTotalCount",
    );
    if (count < 1 || count > MAX_RATE_CHANGE_COUNT) {
      throw new RangeError(
        `rateChangeTotalCount must be between 1 and ${MAX_RATE_CHANGE_COUNT}, received: ${count}`,
      );
    }
  }

  const usedCount = assertNonNegativeInteger(
    o.rateChangeUsedCount,
    "rateChangeUsedCount",
  );
  if (
    o.rateChangeTotalCount !== null &&
    o.rateChangeScope !== "per_year" &&
    usedCount > o.rateChangeTotalCount
  ) {
    throw new RangeError(
      `rateChangeUsedCount (${usedCount}) cannot exceed rateChangeTotalCount (${o.rateChangeTotalCount})`,
    );
  }

  if (o.rateChangeMinRepaymentBps !== null) {
    assertBpsRange(o.rateChangeMinRepaymentBps, "rateChangeMinRepaymentBps", 0);
  }
  if (o.rateChangeMaxRepaymentBps !== null) {
    assertBpsRange(o.rateChangeMaxRepaymentBps, "rateChangeMaxRepaymentBps", 0);
  }
  if (
    o.rateChangeMinRepaymentBps !== null &&
    o.rateChangeMaxRepaymentBps !== null &&
    o.rateChangeMinRepaymentBps > o.rateChangeMaxRepaymentBps
  ) {
    throw new RangeError(
      "rateChangeMinRepaymentBps cannot exceed rateChangeMaxRepaymentBps",
    );
  }

  if (o.rateChangeMinMonthlyCents !== null) {
    assertNonNegativeInteger(
      o.rateChangeMinMonthlyCents,
      "rateChangeMinMonthlyCents",
    );
  }
  if (o.rateChangeMaxMonthlyCents !== null) {
    assertNonNegativeInteger(
      o.rateChangeMaxMonthlyCents,
      "rateChangeMaxMonthlyCents",
    );
  }
  if (
    o.rateChangeMinMonthlyCents !== null &&
    o.rateChangeMaxMonthlyCents !== null &&
    o.rateChangeMinMonthlyCents > o.rateChangeMaxMonthlyCents
  ) {
    throw new RangeError(
      "rateChangeMinMonthlyCents cannot exceed rateChangeMaxMonthlyCents",
    );
  }

  // Check corridor intersection when both bps and cents bounds are present
  const hasBps =
    o.rateChangeMinRepaymentBps !== null ||
    o.rateChangeMaxRepaymentBps !== null;
  const hasCents =
    o.rateChangeMinMonthlyCents !== null ||
    o.rateChangeMaxMonthlyCents !== null;
  if (
    o.rateChangeRight === "allowed" &&
    hasBps &&
    hasCents &&
    context?.repaymentType !== "lump_sum" &&
    o.originalPrincipalCents !== null &&
    o.originalPrincipalCents > 0
  ) {
    const baseCents = o.originalPrincipalCents;
    const interestBps = context?.interestRateBps ?? 0;
    const toCents = (bps: number) =>
      context?.repaymentType === "installment"
        ? installmentRateFromRepaymentBps(baseCents, bps)
        : annuityRateFromRepaymentBps(baseCents, interestBps, bps);

    const lowerBounds: number[] = [];
    if (o.rateChangeMinRepaymentBps !== null) {
      lowerBounds.push(toCents(o.rateChangeMinRepaymentBps));
    }
    if (o.rateChangeMinMonthlyCents !== null) {
      lowerBounds.push(o.rateChangeMinMonthlyCents);
    }

    const upperBounds: number[] = [];
    if (o.rateChangeMaxRepaymentBps !== null) {
      upperBounds.push(toCents(o.rateChangeMaxRepaymentBps));
    }
    if (o.rateChangeMaxMonthlyCents !== null) {
      upperBounds.push(o.rateChangeMaxMonthlyCents);
    }

    if (lowerBounds.length > 0 && upperBounds.length > 0) {
      const effMin = Math.max(...lowerBounds);
      const effMax = Math.min(...upperBounds);
      if (effMin > effMax) {
        throw new RangeError(
          `Rate corridor intersection is empty: min ${effMin} > max ${effMax}`,
        );
      }
    }
  }
}

/**
 * Resolves a contract's special repayment configuration into a serializable SpecialRepaymentRule.
 */
export function specialRepaymentRule(
  contract: DomainContract,
): SpecialRepaymentRule {
  const o = getLoanOptions(contract);
  if (o.specialRepaymentRight === "none") {
    return { kind: "none" };
  }
  if (o.specialRepaymentRight === "unknown") {
    return { kind: "unknown" };
  }

  // allowed
  if (o.specialRepaymentBasis === null) {
    return { kind: "allowed_unknown_amount", missingOriginalPrincipal: false };
  }

  if (o.specialRepaymentBasis === "fixed_yearly") {
    if (o.specialRepaymentMaxYearlyCents === null) {
      return { kind: "allowed_unknown_amount", missingOriginalPrincipal: false };
    }
    return { kind: "fixed", capCents: o.specialRepaymentMaxYearlyCents };
  }

  if (o.specialRepaymentBasis === "percent_original") {
    if (o.specialRepaymentPercentBps === null) {
      return { kind: "allowed_unknown_amount", missingOriginalPrincipal: false };
    }
    if (o.originalPrincipalCents === null) {
      return { kind: "allowed_unknown_amount", missingOriginalPrincipal: true };
    }
    // Floor to cents: never overestimate a contractual right
    const capBig =
      (BigInt(o.originalPrincipalCents) * BigInt(o.specialRepaymentPercentBps)) /
      BPS_DENOMINATOR;
    return {
      kind: "fixed",
      capCents: assertSafeInteger(Number(capBig), "yearlyCapCents"),
    };
  }

  // percent_balance
  if (o.specialRepaymentPercentBps === null) {
    return { kind: "allowed_unknown_amount", missingOriginalPrincipal: false };
  }
  return { kind: "percent_balance", bps: o.specialRepaymentPercentBps };
}

/**
 * Computes the yearly special repayment cap in cents for a given rule and year-start balance.
 * Returns null when the cap is unknown (simulated unbounded with capUnknown flag).
 * Always uses BigInt floor division so a right is never overestimated.
 */
export function resolveYearlyCapCents(
  rule: SpecialRepaymentRule,
  balanceAtYearStartCents: number,
): number | null {
  const safeBalance = assertNonNegativeInteger(
    balanceAtYearStartCents,
    "balanceAtYearStartCents",
  );
  switch (rule.kind) {
    case "none":
      return 0;
    case "unknown":
    case "allowed_unknown_amount":
      return null;
    case "fixed":
      return assertNonNegativeInteger(rule.capCents, "capCents");
    case "percent_balance": {
      const safeBps = assertBpsRange(rule.bps, "bps", 0);
      const capBig = (BigInt(safeBalance) * BigInt(safeBps)) / BPS_DENOMINATOR;
      return assertSafeInteger(Number(capBig), "yearlyCapCents");
    }
  }
}

/**
 * Computes remaining special repayment allowance for a loan in the calendar year of asOfDate.
 */
export function remainingSpecialRepaymentCents(
  contract: DomainContract,
  asOfDate: string,
  balanceCents: number = contract.currentBalanceCents,
): SpecialRepaymentAllowance {
  const asOfYear = parseIsoDate(asOfDate, "asOfDate").year;
  const safeBalance = assertNonNegativeInteger(balanceCents, "balanceCents");
  const o = getLoanOptions(contract);
  const rule = specialRepaymentRule(contract);
  const capCents = resolveYearlyCapCents(rule, safeBalance);

  const usageFromOtherYear =
    o.specialRepaymentUsedYear !== null &&
    o.specialRepaymentUsedYear !== asOfYear;
  const usedCents =
    o.specialRepaymentUsedYear === asOfYear
      ? (o.specialRepaymentUsedCents ?? 0)
      : 0;
  const remainingCents =
    capCents === null ? null : Math.max(0, capCents - usedCents);

  return {
    status: o.specialRepaymentRight,
    rule,
    basis: o.specialRepaymentBasis,
    percentBps: o.specialRepaymentPercentBps,
    capCents,
    usedCents,
    usedYear: o.specialRepaymentUsedYear,
    remainingCents,
    flags: {
      capUnknown: capCents === null,
      missingOriginalPrincipal:
        rule.kind === "allowed_unknown_amount" && rule.missingOriginalPrincipal,
      usageFromOtherYear,
    },
  };
}

/**
 * Resolves the contractual rate-change corridor for a loan as of asOfDate.
 */
export function resolveRateCorridor(
  contract: DomainContract,
  asOfDate: string,
  currentBalanceCentsOverride?: number,
): RateCorridor {
  parseIsoDate(asOfDate, "asOfDate");
  const o = getLoanOptions(contract);
  const currentMonthlyCents = assertNonNegativeInteger(
    contract.monthlyRateCents,
    "monthlyRateCents",
  );
  const effectiveBalanceCents = assertNonNegativeInteger(
    currentBalanceCentsOverride ?? contract.currentBalanceCents,
    "currentBalanceCents",
  );
  const monthlyInterestCents =
    effectiveBalanceCents === 0 || contract.interestRateBps === 0
      ? 0
      : assertSafeInteger(
          Number(
            roundHalfUpBigInt(
              BigInt(effectiveBalanceCents) * BigInt(contract.interestRateBps),
              MONTHS_PER_YEAR_IN_BPS_DENOMINATOR,
            ),
          ),
          "monthlyInterestCents",
        );

  if (contract.category !== "loan" || contract.repaymentType === "lump_sum") {
    return {
      status: "not_applicable",
      currentMonthlyCents,
      minMonthlyCents: null,
      maxMonthlyCents: null,
      sliderMinMonthlyCents: null,
      monthlyInterestCents,
      remainingChanges: null,
      latestChangeDate: null,
      minRepaymentBps: null,
      maxRepaymentBps: null,
      flags: {
        corridorAssumed: false,
        approximatedBase: false,
        currentOutsideCorridor: false,
        minBelowInterest: false,
        perYearUsageUntracked: false,
        exhausted: false,
        corridorEmpty: false,
      },
    };
  }

  if (o.rateChangeRight === "none") {
    return {
      status: "none",
      currentMonthlyCents,
      minMonthlyCents: null,
      maxMonthlyCents: null,
      sliderMinMonthlyCents: null,
      monthlyInterestCents,
      remainingChanges: 0,
      latestChangeDate: null,
      minRepaymentBps: null,
      maxRepaymentBps: null,
      flags: {
        corridorAssumed: false,
        approximatedBase: false,
        currentOutsideCorridor: false,
        minBelowInterest: false,
        perYearUsageUntracked: false,
        exhausted: false,
        corridorEmpty: false,
      },
    };
  }

  const status = o.rateChangeRight; // "unknown" | "allowed"
  const perYearUsageUntracked =
    status === "allowed" && o.rateChangeScope === "per_year";

  let remainingChanges: number | null = null;
  let exhausted = false;
  if (status === "allowed" && o.rateChangeTotalCount !== null) {
    if (perYearUsageUntracked) {
      remainingChanges = o.rateChangeTotalCount;
      exhausted = false;
    } else {
      remainingChanges = Math.max(
        0,
        o.rateChangeTotalCount - o.rateChangeUsedCount,
      );
      exhausted = remainingChanges === 0;
    }
  }

  const latestChangeDate =
    status === "allowed" && o.rateChangeScope === "fixed_period"
      ? (contract.fixedInterestUntil ?? null)
      : null;

  const baseCents = o.originalPrincipalCents ?? effectiveBalanceCents;
  const toCents = (bps: number): number =>
    contract.repaymentType === "installment"
      ? installmentRateFromRepaymentBps(baseCents, bps)
      : annuityRateFromRepaymentBps(baseCents, contract.interestRateBps, bps);

  const hasExplicitBps =
    o.rateChangeMinRepaymentBps !== null ||
    o.rateChangeMaxRepaymentBps !== null;
  const hasExplicitCents =
    o.rateChangeMinMonthlyCents !== null ||
    o.rateChangeMaxMonthlyCents !== null;
  const hasExplicitMin =
    status === "allowed" &&
    (o.rateChangeMinRepaymentBps !== null ||
      o.rateChangeMinMonthlyCents !== null);
  const hasExplicitMax =
    status === "allowed" &&
    (o.rateChangeMaxRepaymentBps !== null ||
      o.rateChangeMaxMonthlyCents !== null);

  let minMonthlyCents: number;
  let maxMonthlyCents: number;
  let corridorAssumed = false;
  let corridorEmpty = false;
  let usedBpsConversion = false;
  let minRepaymentBps: number | null = null;
  let maxRepaymentBps: number | null = null;

  if (status === "unknown" || (!hasExplicitBps && !hasExplicitCents)) {
    corridorAssumed = true;
    usedBpsConversion = true;
    minRepaymentBps = DEFAULT_RATE_CHANGE_MIN_REPAYMENT_BPS;
    maxRepaymentBps = DEFAULT_RATE_CHANGE_MAX_REPAYMENT_BPS;
    minMonthlyCents = toCents(DEFAULT_RATE_CHANGE_MIN_REPAYMENT_BPS);
    maxMonthlyCents = toCents(DEFAULT_RATE_CHANGE_MAX_REPAYMENT_BPS);
  } else {
    usedBpsConversion = hasExplicitBps;
    minRepaymentBps = o.rateChangeMinRepaymentBps;
    maxRepaymentBps = o.rateChangeMaxRepaymentBps;

    const lowerCandidates: number[] = [];
    if (o.rateChangeMinRepaymentBps !== null) {
      lowerCandidates.push(toCents(o.rateChangeMinRepaymentBps));
    }
    if (o.rateChangeMinMonthlyCents !== null) {
      lowerCandidates.push(o.rateChangeMinMonthlyCents);
    }

    const upperCandidates: number[] = [];
    if (o.rateChangeMaxRepaymentBps !== null) {
      upperCandidates.push(toCents(o.rateChangeMaxRepaymentBps));
    }
    if (o.rateChangeMaxMonthlyCents !== null) {
      upperCandidates.push(o.rateChangeMaxMonthlyCents);
    }

    if (hasExplicitMax) {
      maxMonthlyCents = Math.min(...upperCandidates);
    } else {
      corridorAssumed = true;
      usedBpsConversion = true;
      const defaultMax = toCents(DEFAULT_RATE_CHANGE_MAX_REPAYMENT_BPS);
      maxMonthlyCents = Math.max(
        defaultMax,
        currentMonthlyCents,
        lowerCandidates.length > 0 ? Math.max(...lowerCandidates) : 0,
      );
    }

    if (hasExplicitMin) {
      minMonthlyCents = Math.max(...lowerCandidates);
    } else {
      corridorAssumed = true;
      usedBpsConversion = true;
      minMonthlyCents = Math.min(
        toCents(DEFAULT_RATE_CHANGE_MIN_REPAYMENT_BPS),
        maxMonthlyCents,
      );
    }

    if (minMonthlyCents > maxMonthlyCents) {
      corridorEmpty = true;
      minMonthlyCents = currentMonthlyCents;
      maxMonthlyCents = currentMonthlyCents;
    }
  }

  const approximatedBase =
    usedBpsConversion && o.originalPrincipalCents === null;
  const currentOutsideCorridor =
    !corridorEmpty &&
    (currentMonthlyCents < minMonthlyCents ||
      currentMonthlyCents > maxMonthlyCents);
  const minBelowInterest =
    contract.repaymentType !== "installment" &&
    monthlyInterestCents > 0 &&
    minMonthlyCents <= monthlyInterestCents;
  const sliderMinMonthlyCents = corridorEmpty
    ? currentMonthlyCents
    : minBelowInterest
      ? Math.min(
          maxMonthlyCents,
          Math.max(minMonthlyCents, monthlyInterestCents + 1),
        )
      : minMonthlyCents;

  return {
    status,
    currentMonthlyCents,
    minMonthlyCents,
    maxMonthlyCents,
    sliderMinMonthlyCents,
    monthlyInterestCents,
    remainingChanges,
    latestChangeDate,
    minRepaymentBps,
    maxRepaymentBps,
    flags: {
      corridorAssumed,
      approximatedBase,
      currentOutsideCorridor,
      minBelowInterest,
      perYearUsageUntracked,
      exhausted,
      corridorEmpty,
    },
  };
}
