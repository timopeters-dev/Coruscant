/** Was bringt eine Änderung? Zins/Tilgung je Jahr, Vergleich von Sondertilgung und Ratenwechsel, bester Zeitpunkt. */
import { type DomainContract, validateContract } from "./contract";
import { addMonthsToIsoDate, countCompletedMonths, parseIsoDate } from "@/domain/core/date";
import { resolveRateCorridor } from "./loan-allowances";
import { assertNonNegativeInteger, assertSafeInteger } from "@/domain/core/money";
import {
  type AmortizationOptions, type AmortizationPoint, type LoanAdjustmentEffect, MAX_SERIES_MONTHS,
  type RateChangeTimingPoint, type RateChangeTimingResult, type SpecialRepaymentEffect,
  type SpecialRepaymentOption, type YearlyPaymentSplitRow, type YearlyPaymentSplitSummary,
} from "./amortization-types";
import { buildAmortizationSeries } from "./amortization";

/**
 * Aggregates monthly amortization points into calendar-year payment splits
 * and finds the crossover date (first month with principalCents >= interestCents).
 */
export function summarizeYearlyPaymentSplit(
  points: readonly AmortizationPoint[],
): YearlyPaymentSplitSummary {
  const byYear = new Map<number, YearlyPaymentSplitRow>();
  let crossoverDate: string | null = null;

  for (const pt of points) {
    if (
      crossoverDate === null &&
      pt.monthIndex > 0 &&
      pt.principalCents > 0 &&
      pt.principalCents >= pt.interestCents
    ) {
      crossoverDate = pt.date;
    }

    if (pt.monthIndex === 0 && pt.specialCents === 0) {
      continue;
    }

    const year = parseIsoDate(pt.date, "point.date").year;
    const existing = byYear.get(year);
    if (existing) {
      existing.interestCents += pt.interestCents;
      existing.principalCents += pt.principalCents;
      existing.specialCents += pt.specialCents;
      existing.endBalanceCents = pt.balanceCents;
    } else {
      byYear.set(year, {
        year,
        interestCents: pt.interestCents,
        principalCents: pt.principalCents,
        specialCents: pt.specialCents,
        endBalanceCents: pt.balanceCents,
      });
    }
  }

  const rows = [...byYear.values()].sort((a, b) => a.year - b.year);
  return { rows, crossoverDate };
}

function sumCashOutUntil(
  points: readonly AmortizationPoint[],
  maxMonthIndex: number,
): number {
  let total = 0;
  for (const pt of points) {
    if (pt.monthIndex > maxMonthIndex) break;
    total += pt.interestCents + pt.principalCents + pt.specialCents;
  }
  return total;
}

/**
 * Compares baseline vs. adjusted loan series (special repayment, rate change, or both).
 */
export function compareLoanAdjustments(
  contract: DomainContract,
  options: AmortizationOptions,
): LoanAdjustmentEffect {
  const baseline = buildAmortizationSeries(contract, {
    asOfDate: options.asOfDate,
    maxMonths: options.maxMonths,
  });
  const adjusted = buildAmortizationSeries(contract, options);

  const balanceAtFixedEndDeltaCents =
    baseline.balanceAtFixedInterestEndCents !== null &&
    adjusted.balanceAtFixedInterestEndCents !== null
      ? baseline.balanceAtFixedInterestEndCents -
        adjusted.balanceAtFixedInterestEndCents
      : null;

  const interestSavedUntilFixedEndCents =
    baseline.interestUntilFixedEndCents !== null &&
    adjusted.interestUntilFixedEndCents !== null
      ? baseline.interestUntilFixedEndCents -
        adjusted.interestUntilFixedEndCents
      : null;

  const interestSavedTotalCents =
    baseline.totalInterestCents - adjusted.totalInterestCents;

  const monthsSaved =
    baseline.paidOffMonthIndex !== null && adjusted.paidOffMonthIndex !== null
      ? baseline.paidOffMonthIndex - adjusted.paidOffMonthIndex
      : null;

  let extraPaidUntilFixedEndCents: number | null = null;
  if (
    contract.fixedInterestUntil != null &&
    contract.fixedInterestUntil >= baseline.startDate
  ) {
    const fixedIdx = countCompletedMonths(
      baseline.startDate,
      contract.fixedInterestUntil,
    );
    extraPaidUntilFixedEndCents =
      sumCashOutUntil(adjusted.points, fixedIdx) -
      sumCashOutUntil(baseline.points, fixedIdx);
  }

  const maxIdx = Math.max(
    baseline.points[baseline.points.length - 1]!.monthIndex,
    adjusted.points[adjusted.points.length - 1]!.monthIndex,
  );
  const extraPaidTotalCents =
    sumCashOutUntil(adjusted.points, maxIdx) -
    sumCashOutUntil(baseline.points, maxIdx);

  const baselineSplit = summarizeYearlyPaymentSplit(baseline.points);
  const adjustedSplit = summarizeYearlyPaymentSplit(adjusted.points);

  return {
    baseline,
    adjusted,
    balanceAtFixedEndDeltaCents,
    interestSavedUntilFixedEndCents,
    interestSavedTotalCents,
    monthsSaved,
    extraPaidUntilFixedEndCents,
    extraPaidTotalCents,
    crossover: {
      baseline: baselineSplit.crossoverDate,
      adjusted: adjustedSplit.crossoverDate,
    },
  };
}

/**
 * Compares a contract series with and without a simulated special repayment.
 * Thin wrapper around compareLoanAdjustments for backward compatibility.
 */
export function compareSpecialRepayment(
  contract: DomainContract,
  options: AmortizationOptions & { specialRepayment: SpecialRepaymentOption },
): SpecialRepaymentEffect {
  const effect = compareLoanAdjustments(contract, options);
  return {
    baseline: effect.baseline,
    withSpecial: effect.adjusted,
    balanceAtFixedEndDeltaCents: effect.balanceAtFixedEndDeltaCents,
    interestSavedUntilFixedEndCents: effect.interestSavedUntilFixedEndCents,
    interestSavedTotalCents: effect.interestSavedTotalCents,
    monthsSaved: effect.monthsSaved,
  };
}

/**
 * Computes interest saved until horizonEndDate as a function of rate-change start month,
 * plus costPerYearDelayCents (difference between starting now vs. 12 months later).
 */
export function buildRateChangeTimingSeries(
  contract: DomainContract,
  options: {
    asOfDate: string;
    newMonthlyRateCents: number;
    horizonEndDate: string;
    maxPoints?: number;
  },
): RateChangeTimingResult {
  validateContract(contract);
  parseIsoDate(options.asOfDate, "asOfDate");
  parseIsoDate(options.horizonEndDate, "horizonEndDate");
  assertNonNegativeInteger(options.newMonthlyRateCents, "newMonthlyRateCents");
  const maxPoints =
    options.maxPoints !== undefined
      ? assertSafeInteger(options.maxPoints, "maxPoints")
      : 60;
  if (maxPoints < 2) {
    throw new RangeError(`maxPoints must be >= 2, received: ${maxPoints}`);
  }

  const corridor = resolveRateCorridor(contract, options.asOfDate);
  if (
    contract.status !== "active" ||
    corridor.status === "none" ||
    corridor.status === "not_applicable" ||
    corridor.flags.exhausted ||
    corridor.flags.corridorEmpty
  ) {
    return { points: [], costPerYearDelayCents: null };
  }

  const maxStartDate =
    corridor.latestChangeDate !== null &&
    corridor.latestChangeDate < options.horizonEndDate
      ? corridor.latestChangeDate
      : options.horizonEndDate;

  const firstCandidate = addMonthsToIsoDate(options.asOfDate, 1);
  if (firstCandidate > maxStartDate) {
    return { points: [], costPerYearDelayCents: null };
  }

  const candidateDates: string[] = [];
  for (let offset = 1; offset <= MAX_SERIES_MONTHS; offset += 1) {
    const d = addMonthsToIsoDate(options.asOfDate, offset);
    if (d > maxStartDate) break;
    candidateDates.push(d);
  }
  if (candidateDates.length === 0) {
    return { points: [], costPerYearDelayCents: null };
  }

  const horizonMonths = Math.min(
    MAX_SERIES_MONTHS,
    Math.max(1, countCompletedMonths(contract.balanceAsOfDate, options.horizonEndDate)),
  );

  // Sample candidate dates to at most maxPoints, always preserving first and last
  let selectedDates: string[];
  if (candidateDates.length <= maxPoints) {
    selectedDates = candidateDates;
  } else {
    selectedDates = [];
    const lastIdx = candidateDates.length - 1;
    const lastSample = maxPoints - 1;
    let prevIdx = -1;
    for (let i = 0; i < maxPoints; i += 1) {
      const idx = Math.round((i * lastIdx) / lastSample);
      if (idx !== prevIdx) {
        selectedDates.push(candidateDates[idx]!);
        prevIdx = idx;
      }
    }
  }

  const savedAtDate = (startDate: string): number => {
    const cmp = compareLoanAdjustments(contract, {
      asOfDate: options.asOfDate,
      rateChange: {
        date: startDate,
        newMonthlyRateCents: options.newMonthlyRateCents,
      },
      maxMonths: horizonMonths,
    });
    return cmp.interestSavedTotalCents;
  };

  const points: RateChangeTimingPoint[] = selectedDates.map((startDate) => ({
    startDate,
    interestSavedCents: savedAtDate(startDate),
  }));

  let costPerYearDelayCents: number | null = null;
  const horizonFromAsOfMonths = countCompletedMonths(
    options.asOfDate,
    options.horizonEndDate,
  );
  if (horizonFromAsOfMonths >= 12) {
    const savedNow = points[0]!.interestSavedCents;
    const date12m = addMonthsToIsoDate(options.asOfDate, 13);
    const saved12m = date12m <= maxStartDate ? savedAtDate(date12m) : 0;
    costPerYearDelayCents = savedNow - saved12m;
  }

  return { points, costPerYearDelayCents };
}
