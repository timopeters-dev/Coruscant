/** Prüft die Darlehensoptionen eines Vertrags auf Vollständigkeit und Widersprüche. */
import { assertNonNegativeInteger, assertSafeInteger } from "@/domain/core/money";
import { type LoanOptions, type LoanOptionsValidationContext, MAX_RATE_CHANGE_COUNT, annuityRateFromRepaymentBps, installmentRateFromRepaymentBps } from "./loan-options";

export function assertBpsRange(
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
