/** Was ist erlaubt? Sondertilgungs-Kontingent je Jahr und Korridor für Tilgungssatzwechsel. */
import type { DomainContract } from "./contract";
import { parseIsoDate } from "@/domain/core/date";
import { assertNonNegativeInteger, assertSafeInteger, roundHalfUpBigInt } from "@/domain/core/money";
import { assertBpsRange } from "./loan-options-validation";
import { BPS_DENOMINATOR, DEFAULT_RATE_CHANGE_MAX_REPAYMENT_BPS, DEFAULT_RATE_CHANGE_MIN_REPAYMENT_BPS, MONTHS_PER_YEAR_IN_BPS_DENOMINATOR, type RateCorridor, type SpecialRepaymentAllowance, type SpecialRepaymentRule, annuityRateFromRepaymentBps, getLoanOptions, installmentRateFromRepaymentBps } from "./loan-options";

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
