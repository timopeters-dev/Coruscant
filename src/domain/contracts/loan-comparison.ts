import type { DomainContract, RepaymentType } from "./contract";
import { parseIsoDate } from "@/domain/core/date";
import type { RateCorridor, SpecialRepaymentAllowance } from "./loan-options";
import { assertNonNegativeInteger, assertSafeInteger } from "@/domain/core/money";
import {
  type BreakEvenResult,
  buildPrepaymentDefaults,
  findBreakEvenReturnBps,
  simulatePrepaymentVsEtf,
} from "@/domain/planning/scenarios";

export const LOAN_COMPARISON_PROBE_CENTS = 100_000;
export const LOAN_COMPARISON_RATE_PROBE_CENTS = 10_000;

export interface LoanComparisonAssumptions {
  etfAnnualReturnBps: number;
  safetyMarginBps: number;
  saverAllowanceCents: number;
  churchTaxBps: 0 | 800 | 900;
}

export type LoanComparisonVerdict = "loan" | "etf" | "close";

export interface LoanComparisonProbe {
  probeCents: number;
  interestSavedCents: number;
  breakEven: BreakEvenResult;
  probeLimited: boolean;
}

export interface LoanComparisonRow {
  loanId: string;
  loanName: string;
  projectedBalanceCents: number;
  interestRateBps: number;
  monthlyRateCents: number;
  repaymentType: RepaymentType | null;
  horizonEndDate: string;
  horizonEstimated: boolean;
  specialAllowance: SpecialRepaymentAllowance;
  rateCorridor: RateCorridor;
  special: LoanComparisonProbe | null;
  rate: LoanComparisonProbe | null;
  bestBreakEven: BreakEvenResult | null;
  verdict: LoanComparisonVerdict;
}

function breakEvenSortScore(be: BreakEvenResult | null): number {
  if (be === null || be.kind === "identical") return -1;
  if (be.kind === "unreachable") return 1_000_000;
  return be.bps;
}

function pickBestBreakEven(
  a: BreakEvenResult | null,
  b: BreakEvenResult | null,
): BreakEvenResult | null {
  if (a === null) return b;
  if (b === null) return a;
  return breakEvenSortScore(a) >= breakEvenSortScore(b) ? a : b;
}

function computeVerdict(
  be: BreakEvenResult | null,
  etfAnnualReturnBps: number,
  safetyMarginBps: number,
): LoanComparisonVerdict {
  if (be === null || be.kind === "identical") {
    return "etf";
  }
  if (be.kind === "unreachable") {
    return "loan";
  }
  const diff = etfAnnualReturnBps - be.bps;
  if (Math.abs(diff) < safetyMarginBps) {
    return "close";
  }
  return diff >= safetyMarginBps ? "etf" : "loan";
}

function compareStrings(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/**
 * Ranks all active loans with positive projected balance by break-even return
 * (special repayment 1.000 € one-time probe and +100 €/month rate probe).
 * Pure domain computation built solely on simulatePrepaymentVsEtf / findBreakEvenReturnBps.
 */
export function buildLoanComparison(
  contracts: readonly DomainContract[],
  options: {
    asOfDate: string;
    assumptions: LoanComparisonAssumptions;
  },
): LoanComparisonRow[] {
  parseIsoDate(options.asOfDate, "asOfDate");
  const { assumptions } = options;
  assertSafeInteger(assumptions.etfAnnualReturnBps, "etfAnnualReturnBps");
  assertNonNegativeInteger(assumptions.safetyMarginBps, "safetyMarginBps");

  const rows: LoanComparisonRow[] = [];

  for (const contract of contracts) {
    if (contract.category !== "loan" || contract.status !== "active") {
      continue;
    }

    const defaults = buildPrepaymentDefaults(contract, options.asOfDate);
    if (defaults.loan.balanceCents <= 0) {
      continue;
    }

    const { specialAllowance, rateCorridor } = defaults;

    // 1. Special repayment probe (up to 1.000 € one-time)
    let special: LoanComparisonProbe | null = null;
    if (
      specialAllowance.status !== "none" &&
      specialAllowance.remainingCents !== 0
    ) {
      const available =
        specialAllowance.remainingCents !== null
          ? Math.min(specialAllowance.remainingCents, defaults.loan.balanceCents)
          : defaults.loan.balanceCents;
      const probeCents = Math.min(LOAN_COMPARISON_PROBE_CENTS, available);
      if (probeCents > 0) {
        const probeInput = {
          loan: defaults.loan,
          startDate: defaults.startDate,
          horizonEndDate: defaults.horizonEndDate,
          oneTimeAmountCents: probeCents,
          monthlyAmountCents: 0,
          specialRepaymentUsedThisYearCents: specialAllowance.usedCents,
          saverAllowanceCents: assumptions.saverAllowanceCents,
          churchTaxBps: assumptions.churchTaxBps,
        };
        const sim = simulatePrepaymentVsEtf({
          ...probeInput,
          etfAnnualReturnBps: assumptions.etfAnnualReturnBps,
        });
        const breakEven = findBreakEvenReturnBps(probeInput);
        special = {
          probeCents,
          interestSavedCents: sim.interestSavedCents,
          breakEven,
          probeLimited: probeCents < LOAN_COMPARISON_PROBE_CENTS,
        };
      }
    }

    // 2. Rate increase probe (up to +100 €/month within corridor)
    let rate: LoanComparisonProbe | null = null;
    if (
      rateCorridor.status !== "none" &&
      rateCorridor.status !== "not_applicable" &&
      !rateCorridor.flags.exhausted &&
      !rateCorridor.flags.corridorEmpty &&
      rateCorridor.maxMonthlyCents !== null
    ) {
      const headroom = Math.max(
        0,
        rateCorridor.maxMonthlyCents - rateCorridor.currentMonthlyCents,
      );
      const probeCents = Math.min(LOAN_COMPARISON_RATE_PROBE_CENTS, headroom);
      if (probeCents > 0) {
        const probeInput = {
          loan: defaults.loan,
          startDate: defaults.startDate,
          horizonEndDate: defaults.horizonEndDate,
          oneTimeAmountCents: 0,
          monthlyAmountCents: probeCents,
          monthlyChannel: "rate_increase" as const,
          monthlyStartMonth: 1,
          saverAllowanceCents: assumptions.saverAllowanceCents,
          churchTaxBps: assumptions.churchTaxBps,
        };
        const sim = simulatePrepaymentVsEtf({
          ...probeInput,
          etfAnnualReturnBps: assumptions.etfAnnualReturnBps,
        });
        const breakEven = findBreakEvenReturnBps(probeInput);
        rate = {
          probeCents,
          interestSavedCents: sim.interestSavedCents,
          breakEven,
          probeLimited: probeCents < LOAN_COMPARISON_RATE_PROBE_CENTS,
        };
      }
    }

    const bestBreakEven = pickBestBreakEven(
      special?.breakEven ?? null,
      rate?.breakEven ?? null,
    );
    const verdict = computeVerdict(
      bestBreakEven,
      assumptions.etfAnnualReturnBps,
      assumptions.safetyMarginBps,
    );

    rows.push({
      loanId: contract.id,
      loanName: contract.name,
      projectedBalanceCents: defaults.loan.balanceCents,
      interestRateBps: contract.interestRateBps,
      monthlyRateCents: contract.monthlyRateCents,
      repaymentType: contract.repaymentType ?? null,
      horizonEndDate: defaults.horizonEndDate,
      horizonEstimated: defaults.horizonEstimated,
      specialAllowance,
      rateCorridor,
      special,
      rate,
      bestBreakEven,
      verdict,
    });
  }

  rows.sort(
    (a, b) =>
      breakEvenSortScore(b.bestBreakEven) - breakEvenSortScore(a.bestBreakEven) ||
      b.interestRateBps - a.interestRateBps ||
      compareStrings(a.loanId, b.loanId),
  );

  return rows;
}
