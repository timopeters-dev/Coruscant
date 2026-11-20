import type { ContractCategory, DomainContract, RepaymentType } from "./contract";
import {
  assertNonNegativeInteger, assertSafeInteger, roundHalfUpBigInt,
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

export const BPS_DENOMINATOR = 10_000n;
export const MONTHS_PER_YEAR_IN_BPS_DENOMINATOR = 120_000n;

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
