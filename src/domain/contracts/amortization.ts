/** Monatlicher Verlauf eines Vertrags (Tilgungsplan bzw. Ansparverlauf) inkl. Sondertilgung und Ratenwechsel. */
import { applyCappedSpecialRepayment, type DomainContract, getCalibrationAge, stepContractMonth, validateContract } from "./contract";
import { addMonthsToIsoDate, countCompletedMonths, parseIsoDate } from "@/domain/core/date";
import { remainingSpecialRepaymentCents, resolveRateCorridor, resolveYearlyCapCents, specialRepaymentRule } from "./loan-options";
import { assertNonNegativeInteger, assertSafeInteger, roundHalfUpBigInt } from "@/domain/core/money";
import { type AmortizationMarker, type AmortizationOptions, type AmortizationPoint, type AmortizationSeriesResult, DEFAULT_FLAT_HORIZON_MONTHS, MAX_SERIES_MONTHS, type RateChangeSummary } from "./amortization-types";

/**
 * Clamps `asOfDate` to at least `balanceAsOfDate` so contracts with future calibration dates
 * can be summarized safely without throwing.
 */
export function effectiveAsOf(
  asOfDate: string,
  balanceAsOfDate: string,
): string {
  parseIsoDate(asOfDate, "asOfDate");
  parseIsoDate(balanceAsOfDate, "balanceAsOfDate");
  return asOfDate >= balanceAsOfDate ? asOfDate : balanceAsOfDate;
}

function compareStrings(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function maxIsoDate(a: string, b: string): string {
  return a >= b ? a : b;
}

function isAllocationThresholdMet(
  balanceCents: number,
  targetSumCents: number,
  thresholdPercent: number,
): boolean {
  return (
    BigInt(balanceCents) * 100n >=
    BigInt(targetSumCents) * BigInt(thresholdPercent)
  );
}

/**
 * Deterministically samples `values` to at most `maxPoints`, preserving the first and last elements.
 */
export function sampleSeries(
  values: readonly number[],
  maxPoints: number,
): number[] {
  const safeMax = assertSafeInteger(maxPoints, "maxPoints");
  if (safeMax < 2) {
    throw new RangeError(
      `maxPoints must be >= 2, received: ${safeMax}`,
    );
  }
  if (values.length <= safeMax) {
    return [...values];
  }
  const result: number[] = [];
  const lastIndex = values.length - 1;
  const lastSample = safeMax - 1;
  for (let i = 0; i < safeMax; i += 1) {
    const idx = Math.round((i * lastIndex) / lastSample);
    result.push(values[idx]!);
  }
  return result;
}

/**
 * Builds a monthly amortization / savings progression series from `balanceAsOfDate`.
 */
export function buildAmortizationSeries(
  contract: DomainContract,
  options: AmortizationOptions,
): AmortizationSeriesResult {
  validateContract(contract);
  parseIsoDate(options.asOfDate, "asOfDate");
  if (options.asOfDate < contract.balanceAsOfDate) {
    throw new RangeError(
      `asOfDate (${options.asOfDate}) must be >= balanceAsOfDate (${contract.balanceAsOfDate})`,
    );
  }

  if (contract.fixedInterestUntil != null) {
    parseIsoDate(contract.fixedInterestUntil, "fixedInterestUntil");
  }
  if (contract.milestoneDate != null) {
    parseIsoDate(contract.milestoneDate, "milestoneDate");
  }

  const maxHorizon =
    options.maxMonths !== undefined
      ? assertSafeInteger(options.maxMonths, "maxMonths")
      : MAX_SERIES_MONTHS;
  if (maxHorizon < 1 || maxHorizon > MAX_SERIES_MONTHS) {
    throw new RangeError(
      `maxMonths must be between 1 and ${MAX_SERIES_MONTHS}, received: ${maxHorizon}`,
    );
  }

  const sr = options.specialRepayment ?? null;
  if (sr !== null) {
    if (contract.category === "savings_contract") {
      throw new RangeError(
        "specialRepayment is not supported for savings_contract",
      );
    }
    assertNonNegativeInteger(sr.amountCents, "specialRepayment.amountCents");
    parseIsoDate(sr.date, "specialRepayment.date");
    if (sr.date < options.asOfDate) {
      throw new RangeError(
        `specialRepayment.date (${sr.date}) must be >= asOfDate (${options.asOfDate})`,
      );
    }
    assertNonNegativeInteger(
      sr.usedThisYearCents ?? 0,
      "specialRepayment.usedThisYearCents",
    );
  }

  const rc = options.rateChange ?? null;
  if (rc !== null) {
    if (contract.category === "savings_contract") {
      throw new RangeError("rateChange is not supported for savings_contract");
    }
    assertNonNegativeInteger(
      rc.newMonthlyRateCents,
      "rateChange.newMonthlyRateCents",
    );
    parseIsoDate(rc.date, "rateChange.date");
    if (rc.date < options.asOfDate) {
      throw new RangeError(
        `rateChange.date (${rc.date}) must be >= asOfDate (${options.asOfDate})`,
      );
    }
  }

  const startDate = contract.balanceAsOfDate;
  const asOfMonthIndex = countCompletedMonths(startDate, options.asOfDate);
  const asOfYear = parseIsoDate(options.asOfDate, "asOfDate").year;
  const { months: calibrationAgeMonths, isStale: staleCalibration } =
    getCalibrationAge(contract, options.asOfDate);

  const isLumpSum =
    contract.category === "loan" && contract.repaymentType === "lump_sum";
  const fixedEnd = contract.fixedInterestUntil ?? null;
  const isAfterFixedEnd = (date: string): boolean =>
    fixedEnd !== null && date > fixedEnd;

  const srRule =
    contract.category === "loan"
      ? specialRepaymentRule(contract)
      : ({ kind: "none" } as const);
  const capUnknown =
    sr !== null &&
    sr.amountCents > 0 &&
    (srRule.kind === "unknown" || srRule.kind === "allowed_unknown_amount");

  const persistedAllowance =
    contract.category === "loan"
      ? remainingSpecialRepaymentCents(contract, options.asOfDate)
      : null;
  const defaultUsedInAsOfYear = persistedAllowance?.usedCents ?? 0;

  // Resolve rate change against contractual corridor
  let rateChangeResult: RateChangeSummary | null = null;
  let rcStartIndex = -1;
  let rcEffectiveRateCents: number | null = null;
  if (rc !== null) {
    const corridor = resolveRateCorridor(contract, options.asOfDate);
    if (
      corridor.status === "none" ||
      corridor.status === "not_applicable" ||
      corridor.flags.exhausted ||
      corridor.flags.corridorEmpty
    ) {
      rateChangeResult = {
        requestedCents: rc.newMonthlyRateCents,
        appliedCents: contract.monthlyRateCents,
        clamped: false,
        notAllowed: true,
        afterLatestDate: false,
      };
    } else if (
      corridor.latestChangeDate !== null &&
      rc.date > corridor.latestChangeDate
    ) {
      rateChangeResult = {
        requestedCents: rc.newMonthlyRateCents,
        appliedCents: contract.monthlyRateCents,
        clamped: false,
        notAllowed: false,
        afterLatestDate: true,
      };
    } else {
      const minRate = corridor.minMonthlyCents!;
      const maxRate = corridor.maxMonthlyCents!;
      const appliedCents = Math.min(
        maxRate,
        Math.max(minRate, rc.newMonthlyRateCents),
      );
      const rawRcIdx = countCompletedMonths(startDate, rc.date);
      rcStartIndex =
        addMonthsToIsoDate(startDate, rawRcIdx) < rc.date
          ? rawRcIdx + 1
          : rawRcIdx;
      rcEffectiveRateCents = appliedCents;
      rateChangeResult = {
        requestedCents: rc.newMonthlyRateCents,
        appliedCents,
        clamped: appliedCents !== rc.newMonthlyRateCents,
        notAllowed: false,
        afterLatestDate: false,
      };
    }
  }

  const allocationThresholdCents =
    contract.category === "savings_contract" &&
    contract.targetSumCents != null &&
    contract.targetSumCents > 0 &&
    contract.allocationThresholdPercent != null
      ? assertSafeInteger(
          Number(
            roundHalfUpBigInt(
              BigInt(contract.targetSumCents) *
                BigInt(contract.allocationThresholdPercent),
              100n,
            ),
          ),
          "allocationThresholdCents",
        )
      : null;

  // Non-active contracts: point 0 + flat point at asOfDate.
  if (contract.status !== "active") {
    const points: AmortizationPoint[] = [
      {
        monthIndex: 0,
        date: startDate,
        balanceCents: contract.currentBalanceCents,
        cumulativeInterestCents: 0,
        cumulativeSpecialCents: 0,
        interestCents: 0,
        principalCents: 0,
        specialCents: 0,
        monthlyRateCents: 0,
        phase: "calibrated",
        afterFixedInterestEnd: isAfterFixedEnd(startDate),
      },
      {
        monthIndex: asOfMonthIndex,
        date: options.asOfDate,
        balanceCents: contract.currentBalanceCents,
        cumulativeInterestCents: 0,
        cumulativeSpecialCents: 0,
        interestCents: 0,
        principalCents: 0,
        specialCents: 0,
        monthlyRateCents: 0,
        phase: "since_calibration",
        afterFixedInterestEnd: isAfterFixedEnd(options.asOfDate),
      },
    ];
    const markers: AmortizationMarker[] = [
      {
        kind: "today",
        date: options.asOfDate,
        monthIndex: asOfMonthIndex,
        label: "Heute",
        balanceCents: contract.currentBalanceCents,
      },
    ];
    return {
      contractId: contract.id,
      category: contract.category,
      startDate,
      asOfDate: options.asOfDate,
      asOfMonthIndex,
      points,
      markers,
      paidOffMonthIndex:
        contract.category === "loan" && contract.currentBalanceCents === 0
          ? 0
          : null,
      paidOffDate:
        contract.category === "loan" && contract.currentBalanceCents === 0
          ? startDate
          : null,
      totalInterestCents: 0,
      interestUntilFixedEndCents: null,
      balanceAtFixedInterestEndCents: null,
      targetReachedDate: null,
      allocationThresholdDate: null,
      allocationThresholdCents,
      special: null,
      rateChange: rateChangeResult,
      flags: {
        notProjected: true,
        neverPaysOff: false,
        rateBelowInterest: false,
        noRate: contract.monthlyRateCents === 0,
        lumpSum: isLumpSum,
        horizonCapped: false,
        capUnknown,
        missingFixedInterestEnd:
          contract.category === "loan" && fixedEnd === null,
        assumesSameRateAfterFixedEnd: false,
        staleCalibration,
        calibrationAgeMonths,
      },
    };
  }

  // Determine target horizon for fixed-length modes
  let flatTargetMonths: number | null = null;
  if (isLumpSum) {
    let end = addMonthsToIsoDate(options.asOfDate, DEFAULT_FLAT_HORIZON_MONTHS);
    if (contract.milestoneDate != null) {
      end = maxIsoDate(end, contract.milestoneDate);
    }
    if (fixedEnd != null) {
      end = maxIsoDate(end, fixedEnd);
    }
    flatTargetMonths = Math.min(
      maxHorizon,
      Math.max(asOfMonthIndex, countCompletedMonths(startDate, end)),
    );
  } else if (contract.category === "savings_contract") {
    const hasTarget =
      contract.targetSumCents != null && contract.targetSumCents > 0;
    const isFlatSavings =
      contract.monthlyRateCents === 0 && contract.interestRateBps === 0;
    if (!hasTarget || isFlatSavings) {
      flatTargetMonths = Math.min(
        maxHorizon,
        asOfMonthIndex + DEFAULT_FLAT_HORIZON_MONTHS,
      );
    }
  }

  const points: AmortizationPoint[] = [];
  let balance = contract.currentBalanceCents;
  let cumulativeInterest = 0;
  let cumulativeSpecial = 0;
  let paidOffMonthIndex: number | null =
    contract.category === "loan" && balance === 0 ? 0 : null;
  let paidOffDate: string | null = paidOffMonthIndex === 0 ? startDate : null;

  let targetReachedDate: string | null = null;
  let targetReachedMonthIndex: number | null = null;
  let allocationThresholdDate: string | null = null;
  let allocationThresholdMonthIndex: number | null = null;

  const hasSavingsTarget =
    contract.category === "savings_contract" &&
    contract.targetSumCents != null &&
    contract.targetSumCents > 0;

  const checkSavingsMilestones = (m: number, date: string): void => {
    if (!hasSavingsTarget) return;
    const target = contract.targetSumCents as number;
    if (
      allocationThresholdDate === null &&
      contract.allocationThresholdPercent != null &&
      isAllocationThresholdMet(
        balance,
        target,
        contract.allocationThresholdPercent,
      )
    ) {
      allocationThresholdDate = date;
      allocationThresholdMonthIndex = m;
    }
    if (targetReachedDate === null && balance >= target) {
      targetReachedDate = date;
      targetReachedMonthIndex = m;
    }
  };

  // Special repayment tracking
  const specialActive = sr !== null && sr.amountCents > 0;
  const rawSrStartIndex =
    sr !== null ? countCompletedMonths(startDate, sr.date) : -1;
  const srStartIndex =
    sr !== null
      ? addMonthsToIsoDate(startDate, rawSrStartIndex) < sr.date
        ? rawSrStartIndex + 1
        : rawSrStartIndex
      : -1;
  const srFirstYear =
    sr !== null ? parseIsoDate(sr.date, "specialRepayment.date").year : 0;
  const capUsedByYear = new Map<number, number>();
  const yearStartBalanceMap = new Map<number, number>();
  let srRequested = 0;
  let srApplied = 0;
  let srCapOverflow = 0;
  let srExceedsDebt = 0;
  let srAfterPayoffIgnored = 0;
  let firstSpecialMarker: {
    monthIndex: number;
    date: string;
    balanceCents: number;
  } | null = null;
  let rateChangeMarker: {
    monthIndex: number;
    date: string;
    balanceCents: number;
  } | null = null;
  let rateBelowInterestFromChange = false;

  const applySpecialAt = (m: number, stepDate: string): number => {
    if (!sr || !specialActive) return 0;
    const isMatch =
      m === srStartIndex ||
      (sr.repeatYearly && m > srStartIndex && (m - srStartIndex) % 12 === 0);
    if (!isMatch) return 0;

    const paymentDate =
      m === srStartIndex
        ? sr.date
        : addMonthsToIsoDate(sr.date, m - srStartIndex);
    const payYear = parseIsoDate(paymentDate, "paymentDate").year;

    if (balance === 0) {
      srAfterPayoffIgnored += sr.amountCents;
      return 0;
    }

    const balanceForCap = yearStartBalanceMap.get(payYear) ?? balance;
    const resolvedCap = resolveYearlyCapCents(srRule, balanceForCap);
    const yearlyCap = resolvedCap ?? Number.MAX_SAFE_INTEGER;

    const usedBefore =
      capUsedByYear.get(payYear) ??
      (payYear === srFirstYear && sr.usedThisYearCents !== undefined
        ? sr.usedThisYearCents
        : payYear === asOfYear
          ? defaultUsedInAsOfYear
          : 0);
    const capRemaining = Math.max(0, yearlyCap - usedBefore);
    const res = applyCappedSpecialRepayment(
      balance,
      sr.amountCents,
      capRemaining,
    );

    balance -= res.appliedCents;
    cumulativeSpecial += res.appliedCents;
    capUsedByYear.set(payYear, usedBefore + res.appliedCents);

    srRequested += sr.amountCents;
    srApplied += res.appliedCents;
    srCapOverflow += res.capOverflowCents;
    srExceedsDebt += res.exceedsDebtCents;

    if (firstSpecialMarker === null) {
      firstSpecialMarker = {
        monthIndex: m,
        date: paymentDate,
        balanceCents: balance,
      };
    }

    if (balance === 0 && paidOffMonthIndex === null) {
      paidOffMonthIndex = m;
      paidOffDate = stepDate;
    }

    return res.appliedCents;
  };

  // Month 0 (calibrated)
  if (asOfMonthIndex === 0) {
    yearStartBalanceMap.set(asOfYear, balance);
  }
  const specialAt0 = srStartIndex === 0 ? applySpecialAt(0, startDate) : 0;
  points.push({
    monthIndex: 0,
    date: startDate,
    balanceCents: balance,
    cumulativeInterestCents: 0,
    cumulativeSpecialCents: cumulativeSpecial,
    interestCents: 0,
    principalCents: 0,
    specialCents: specialAt0,
    monthlyRateCents: 0,
    phase: "calibrated",
    afterFixedInterestEnd: isAfterFixedEnd(startDate),
  });
  checkSavingsMilestones(0, startDate);

  let horizonCapped = false;
  const rcEffectiveMonth =
    rcEffectiveRateCents !== null ? Math.max(1, rcStartIndex) : -1;

  for (let m = 1; m <= maxHorizon; m += 1) {
    // Stop conditions evaluated before advancing to month m:
    if (flatTargetMonths !== null) {
      if (m > flatTargetMonths) break;
      if (isLumpSum && paidOffMonthIndex !== null && m > asOfMonthIndex) break;
    } else if (contract.category === "loan") {
      if (paidOffMonthIndex !== null && m > asOfMonthIndex) break;
    } else if (contract.category === "savings_contract") {
      if (targetReachedDate !== null && m > asOfMonthIndex) break;
    }

    const date = addMonthsToIsoDate(startDate, m);
    const stepYear = parseIsoDate(date, "stepDate").year;

    // Track first simulated balance per future calendar year (after asOfYear)
    if (stepYear > asOfYear && !yearStartBalanceMap.has(stepYear)) {
      yearStartBalanceMap.set(stepYear, balance);
    }

    if (contract.category === "loan" && balance === 0) {
      // Loan already paid off before asOfMonthIndex; pad flat 0 up to asOfMonthIndex
      if (m === asOfMonthIndex) {
        yearStartBalanceMap.set(asOfYear, 0);
      }
      const appliedZero =
        m === srStartIndex ||
        (sr?.repeatYearly &&
          m > srStartIndex &&
          (m - srStartIndex) % 12 === 0)
          ? applySpecialAt(m, date)
          : 0;
      points.push({
        monthIndex: m,
        date,
        balanceCents: 0,
        cumulativeInterestCents: cumulativeInterest,
        cumulativeSpecialCents: cumulativeSpecial,
        interestCents: 0,
        principalCents: 0,
        specialCents: appliedZero,
        monthlyRateCents: 0,
        phase: m <= asOfMonthIndex ? "since_calibration" : "future",
        afterFixedInterestEnd: isAfterFixedEnd(date),
      });
      continue;
    }

    const useNewRate =
      rcEffectiveRateCents !== null && m >= rcEffectiveMonth;
    const stepInput = useNewRate
      ? { ...contract, monthlyRateCents: rcEffectiveRateCents! }
      : contract;

    const step = stepContractMonth(stepInput, balance);
    balance = step.balanceCents;
    cumulativeInterest += step.interestCents;

    if (
      useNewRate &&
      m === rcEffectiveMonth &&
      rcEffectiveRateCents !== contract.monthlyRateCents
    ) {
      if (
        (contract.repaymentType == null ||
          contract.repaymentType === "annuity") &&
        rcEffectiveRateCents! < step.interestCents
      ) {
        rateBelowInterestFromChange = true;
      }
      rateChangeMarker = {
        monthIndex: m,
        date: rc!.date,
        balanceCents: balance,
      };
    }

    if (step.paidOff && paidOffMonthIndex === null) {
      paidOffMonthIndex = m;
      paidOffDate = date;
    }

    if (m === asOfMonthIndex) {
      yearStartBalanceMap.set(asOfYear, balance);
    }

    const appliedSpecial = applySpecialAt(m, date);

    const pointMonthlyRateCents =
      contract.category === "loan" && contract.repaymentType === "installment"
        ? step.principalCents
        : step.paymentCents;

    points.push({
      monthIndex: m,
      date,
      balanceCents: balance,
      cumulativeInterestCents: cumulativeInterest,
      cumulativeSpecialCents: cumulativeSpecial,
      interestCents: step.interestCents,
      principalCents: step.principalCents,
      specialCents: appliedSpecial,
      monthlyRateCents: pointMonthlyRateCents,
      phase: m <= asOfMonthIndex ? "since_calibration" : "future",
      afterFixedInterestEnd: isAfterFixedEnd(date),
    });

    checkSavingsMilestones(m, date);

    if (m === maxHorizon) {
      if (
        contract.category === "loan" &&
        !isLumpSum &&
        paidOffMonthIndex === null
      ) {
        horizonCapped = true;
      } else if (
        contract.category === "savings_contract" &&
        hasSavingsTarget &&
        targetReachedDate === null &&
        !(contract.monthlyRateCents === 0 && contract.interestRateBps === 0)
      ) {
        horizonCapped = true;
      }
    }
  }

  const lastPoint = points[points.length - 1]!;
  const horizonEndDate = lastPoint.date;

  if (
    specialActive &&
    sr !== null &&
    paidOffMonthIndex !== null &&
    srStartIndex > lastPoint.monthIndex
  ) {
    srAfterPayoffIgnored += sr.amountCents;
  }

  // Values at fixedInterestUntil
  let interestUntilFixedEndCents: number | null = null;
  let balanceAtFixedInterestEndCents: number | null = null;
  if (fixedEnd !== null && fixedEnd >= startDate) {
    const fixedIdx = countCompletedMonths(startDate, fixedEnd);
    const fixedPt = points[fixedIdx];
    if (fixedPt) {
      balanceAtFixedInterestEndCents = fixedPt.balanceCents;
      interestUntilFixedEndCents = fixedPt.cumulativeInterestCents;
    } else if (paidOffMonthIndex !== null && fixedIdx <= maxHorizon) {
      balanceAtFixedInterestEndCents = 0;
      interestUntilFixedEndCents = cumulativeInterest;
    }
  }

  // Build markers
  const markers: AmortizationMarker[] = [];
  const asOfPoint = points[Math.min(asOfMonthIndex, points.length - 1)]!;
  markers.push({
    kind: "today",
    date: options.asOfDate,
    monthIndex: asOfMonthIndex,
    label: "Heute",
    balanceCents: asOfPoint.balanceCents,
  });

  if (
    fixedEnd !== null &&
    fixedEnd >= startDate &&
    fixedEnd <= horizonEndDate
  ) {
    const idx = Math.min(
      countCompletedMonths(startDate, fixedEnd),
      points.length - 1,
    );
    markers.push({
      kind: "fixed_interest_end",
      date: fixedEnd,
      monthIndex: idx,
      label: "Zinsbindungsende",
      balanceCents: points[idx]!.balanceCents,
    });
  }

  if (
    contract.milestoneDate != null &&
    contract.milestoneDate >= startDate &&
    contract.milestoneDate <= horizonEndDate
  ) {
    const idx = Math.min(
      countCompletedMonths(startDate, contract.milestoneDate),
      points.length - 1,
    );
    const trimmed = contract.milestoneLabel?.trim() ?? "";
    markers.push({
      kind: "milestone",
      date: contract.milestoneDate,
      monthIndex: idx,
      label: trimmed.length > 0 ? trimmed : "Meilenstein",
      balanceCents: points[idx]!.balanceCents,
    });
  }

  if (paidOffMonthIndex !== null && paidOffDate !== null) {
    markers.push({
      kind: "paid_off",
      date: paidOffDate,
      monthIndex: paidOffMonthIndex,
      label: "Schuldenfrei",
      balanceCents: 0,
    });
  }

  if (
    allocationThresholdDate !== null &&
    allocationThresholdMonthIndex !== null
  ) {
    markers.push({
      kind: "allocation_threshold",
      date: allocationThresholdDate,
      monthIndex: allocationThresholdMonthIndex,
      label: "Zuteilungsschwelle",
      balanceCents: points[allocationThresholdMonthIndex]!.balanceCents,
    });
  }

  if (targetReachedDate !== null && targetReachedMonthIndex !== null) {
    markers.push({
      kind: "target_reached",
      date: targetReachedDate,
      monthIndex: targetReachedMonthIndex,
      label: "Zielsumme erreicht",
      balanceCents: points[targetReachedMonthIndex]!.balanceCents,
    });
  }

  const specialMarker = firstSpecialMarker as {
    monthIndex: number;
    date: string;
    balanceCents: number;
  } | null;
  if (specialMarker !== null) {
    markers.push({
      kind: "special_repayment",
      date: specialMarker.date,
      monthIndex: specialMarker.monthIndex,
      label: "Sondertilgung",
      balanceCents: specialMarker.balanceCents,
    });
  }

  const rcMarker = rateChangeMarker as {
    monthIndex: number;
    date: string;
    balanceCents: number;
  } | null;
  if (rcMarker !== null) {
    markers.push({
      kind: "rate_change",
      date: rcMarker.date,
      monthIndex: rcMarker.monthIndex,
      label: "Ratenänderung",
      balanceCents: rcMarker.balanceCents,
    });
  }

  markers.sort(
    (a, b) =>
      compareStrings(a.date, b.date) ||
      a.monthIndex - b.monthIndex ||
      compareStrings(a.kind, b.kind),
  );

  // Flags
  const isAnnuityLike =
    contract.category === "loan" &&
    (contract.repaymentType == null || contract.repaymentType === "annuity");
  let rateBelowInterest = rateBelowInterestFromChange;
  if (!rateBelowInterest && isAnnuityLike && contract.currentBalanceCents > 0) {
    const firstStep = stepContractMonth(contract, contract.currentBalanceCents);
    rateBelowInterest = contract.monthlyRateCents < firstStep.interestCents;
  }

  const neverPaysOff =
    contract.category === "loan" && !isLumpSum && paidOffMonthIndex === null;

  return {
    contractId: contract.id,
    category: contract.category,
    startDate,
    asOfDate: options.asOfDate,
    asOfMonthIndex,
    points,
    markers,
    paidOffMonthIndex,
    paidOffDate,
    totalInterestCents: cumulativeInterest,
    interestUntilFixedEndCents,
    balanceAtFixedInterestEndCents,
    targetReachedDate,
    allocationThresholdDate,
    allocationThresholdCents,
    special: specialActive
      ? {
          requestedCents: srRequested,
          appliedCents: srApplied,
          capOverflowCents: srCapOverflow,
          exceedsDebtCents: srExceedsDebt,
          afterPayoffIgnoredCents: srAfterPayoffIgnored,
        }
      : null,
    rateChange: rateChangeResult,
    flags: {
      notProjected: false,
      neverPaysOff,
      rateBelowInterest,
      noRate: contract.monthlyRateCents === 0,
      lumpSum: isLumpSum,
      horizonCapped,
      capUnknown,
      missingFixedInterestEnd:
        contract.category === "loan" && fixedEnd === null,
      assumesSameRateAfterFixedEnd:
        contract.category === "loan" &&
        fixedEnd !== null &&
        points.some((p) => p.afterFixedInterestEnd),
      staleCalibration,
      calibrationAgeMonths,
    },
  };
}
