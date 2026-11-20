import { type DomainContract } from "./contract";
import { assertSafeInteger } from "@/domain/core/money";
import { type ContractOverview, OVERVIEW_SPARKLINE_MAX_POINTS } from "./amortization-types";
import { buildAmortizationSeries, effectiveAsOf, sampleSeries } from "./amortization";

export function buildContractOverview(
  contract: DomainContract,
  asOfDate: string,
): ContractOverview {
  const safeAsOf = effectiveAsOf(asOfDate, contract.balanceAsOfDate);
  const series = buildAmortizationSeries(contract, { asOfDate: safeAsOf });
  const fromAsOf = series.points
    .filter((p) => p.monthIndex >= series.asOfMonthIndex)
    .map((p) => p.balanceCents);

  const sparklineCents = sampleSeries(
    fromAsOf,
    OVERVIEW_SPARKLINE_MAX_POINTS,
  );

  let targetProgressBps: number | null = null;
  if (
    contract.category === "savings_contract" &&
    contract.targetSumCents != null &&
    contract.targetSumCents > 0
  ) {
    const asOfPoint =
      series.points.find((p) => p.monthIndex === series.asOfMonthIndex) ??
      series.points[series.points.length - 1]!;
    // Negativer Saldo (Abschlussgebühr) zählt als 0 % Fortschritt.
    const asOfBalance = Math.max(0, asOfPoint.balanceCents);
    const progress =
      (BigInt(asOfBalance) * 10_000n) / BigInt(contract.targetSumCents);
    targetProgressBps = assertSafeInteger(
      Number(progress),
      "targetProgressBps",
    );
  }

  const thresholdBps =
    contract.allocationThresholdPercent != null
      ? contract.allocationThresholdPercent * 100
      : null;

  return {
    sparklineCents,
    paidOffDate: series.paidOffDate,
    neverPaysOff: series.flags.neverPaysOff,
    notProjected: series.flags.notProjected,
    lumpSum: series.flags.lumpSum,
    targetProgressBps,
    thresholdBps,
    calibrationAgeMonths: series.flags.calibrationAgeMonths,
    isCalibrationStale: series.flags.staleCalibration,
  };
}
