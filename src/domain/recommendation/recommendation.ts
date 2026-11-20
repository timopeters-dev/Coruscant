import { type RepaymentType } from "@/domain/contracts/contract";
import {
  addMonthsToIsoDate,
  parseIsoDate,
} from "@/domain/core/date";
import {
  type RateChangeScope,
  type RateCorridor,
  resolveYearlyCapCents,
  type SpecialRepaymentRule,
} from "@/domain/contracts/loan-options";
import {
  assertNonNegativeInteger,
  assertSafeInteger,
} from "@/domain/core/money";
import {
  calculateRequiredMonthlyCents,
  countRemainingMonths,
  evaluatePotDeadlines,
  type PotDeadlineStatus,
} from "@/domain/allocation/pot-deadline";
import {
  ALLOWED_CHURCH_TAX_BPS,
  DEFAULT_ESTIMATED_HORIZON_MONTHS,
  DEFAULT_SAVER_ALLOWANCE_CENTS,
  findBreakEvenReturnBps,
  MAX_ETF_RETURN_BPS,
  MAX_SAVER_ALLOWANCE_CENTS,
  MIN_ETF_RETURN_BPS,
  simulatePrepaymentVsEtf,
} from "@/domain/planning/scenarios";
import { type PotRuleType } from "@/domain/allocation/waterfall";

export const FIXED_INTEREST_SOON_MONTHS = 12;
export const RATE_INCREASE_STEP_CENTS = 1_000;
export const DEFAULT_RATE_INCREASE_MAX_SURPLUS_SHARE_BPS = 5_000;

export interface RecommendationPot {
  id: string;
  name: string;
  priority: number;
  purpose: "emergency_fund" | "goal" | "investment" | null;
  currentCents: number;
  targetCents: number | null;
  targetDate: string | null;
  ruleType: PotRuleType;
  fixedMonthlyCents?: number | null;
  remainderPercentage?: number | null;
  linkedContractId: string | null;
}

export interface RecommendationLoan {
  id: string;
  balanceCents: number;
  interestRateBps: number;
  monthlyRateCents: number;
  repaymentType: RepaymentType | null;
  specialRepaymentMaxYearlyCents: number | null;
  fixedInterestUntil: string | null;
  futureLoanInterestRateBps: number | null;
  specialRepaymentRule?: SpecialRepaymentRule;
  specialRepaymentUsedThisYearCents?: number;
  rateCorridor?: RateCorridor | null;
  rateChangeScope?: RateChangeScope | null;
}

export interface RecommendationState {
  asOfDate: string;
  monthlyExpensesCents: number | null;
  monthlySurplusCents: number;
  pots: RecommendationPot[];
  loans: RecommendationLoan[];
}

export interface RecommendationAssumptions {
  emergencyFundMonths: number;
  etfAnnualReturnBps: number;
  safetyMarginBps: number;
  saverAllowanceCents: number;
  churchTaxBps: 0 | 800 | 900;
  shortHorizonMonths: number;
  savingsBufferBps: number;
  emergencyFillMonths: number;
  rateIncreaseMaxSurplusShareBps: number;
  specialRepaymentUsedThisYearCentsByLoanId: Record<string, number>;
}

export const DEFAULT_RECOMMENDATION_ASSUMPTIONS: RecommendationAssumptions = {
  emergencyFundMonths: 3,
  etfAnnualReturnBps: 600,
  safetyMarginBps: 100,
  saverAllowanceCents: DEFAULT_SAVER_ALLOWANCE_CENTS,
  churchTaxBps: 0,
  shortHorizonMonths: 36,
  savingsBufferBps: 1000,
  emergencyFillMonths: 12,
  rateIncreaseMaxSurplusShareBps: DEFAULT_RATE_INCREASE_MAX_SURPLUS_SHARE_BPS,
  specialRepaymentUsedThisYearCentsByLoanId: {},
};

export function validateRecommendationAssumptions(
  input?: Partial<RecommendationAssumptions>,
): RecommendationAssumptions {
  const merged: RecommendationAssumptions = {
    ...DEFAULT_RECOMMENDATION_ASSUMPTIONS,
    ...input,
    specialRepaymentUsedThisYearCentsByLoanId: {
      ...(input?.specialRepaymentUsedThisYearCentsByLoanId ??
        DEFAULT_RECOMMENDATION_ASSUMPTIONS.specialRepaymentUsedThisYearCentsByLoanId),
    },
  };

  const emergencyFundMonths = assertSafeInteger(
    merged.emergencyFundMonths,
    "emergencyFundMonths",
  );
  if (emergencyFundMonths < 1 || emergencyFundMonths > 12) {
    throw new RangeError(
      `emergencyFundMonths must be between 1 and 12, received: ${emergencyFundMonths}`,
    );
  }

  const etfAnnualReturnBps = assertSafeInteger(
    merged.etfAnnualReturnBps,
    "etfAnnualReturnBps",
  );
  if (
    etfAnnualReturnBps < MIN_ETF_RETURN_BPS ||
    etfAnnualReturnBps > MAX_ETF_RETURN_BPS
  ) {
    throw new RangeError(
      `etfAnnualReturnBps must be between ${MIN_ETF_RETURN_BPS} and ${MAX_ETF_RETURN_BPS}, received: ${etfAnnualReturnBps}`,
    );
  }

  const safetyMarginBps = assertNonNegativeInteger(
    merged.safetyMarginBps,
    "safetyMarginBps",
  );
  if (safetyMarginBps > 500) {
    throw new RangeError(
      `safetyMarginBps must be between 0 and 500, received: ${safetyMarginBps}`,
    );
  }

  const saverAllowanceCents = assertNonNegativeInteger(
    merged.saverAllowanceCents,
    "saverAllowanceCents",
  );
  if (saverAllowanceCents > MAX_SAVER_ALLOWANCE_CENTS) {
    throw new RangeError(
      `saverAllowanceCents must be between 0 and ${MAX_SAVER_ALLOWANCE_CENTS}, received: ${saverAllowanceCents}`,
    );
  }

  const churchTaxBps = assertNonNegativeInteger(
    merged.churchTaxBps,
    "churchTaxBps",
  );
  if (
    !(ALLOWED_CHURCH_TAX_BPS as readonly number[]).includes(churchTaxBps)
  ) {
    throw new RangeError(
      `churchTaxBps must be one of ${ALLOWED_CHURCH_TAX_BPS.join(", ")}, received: ${churchTaxBps}`,
    );
  }

  const shortHorizonMonths = assertSafeInteger(
    merged.shortHorizonMonths,
    "shortHorizonMonths",
  );
  if (shortHorizonMonths < 1 || shortHorizonMonths > 120) {
    throw new RangeError(
      `shortHorizonMonths must be between 1 and 120, received: ${shortHorizonMonths}`,
    );
  }

  const savingsBufferBps = assertNonNegativeInteger(
    merged.savingsBufferBps,
    "savingsBufferBps",
  );
  if (savingsBufferBps > 5000) {
    throw new RangeError(
      `savingsBufferBps must be between 0 and 5000, received: ${savingsBufferBps}`,
    );
  }

  const emergencyFillMonths = assertSafeInteger(
    merged.emergencyFillMonths,
    "emergencyFillMonths",
  );
  if (emergencyFillMonths < 1 || emergencyFillMonths > 60) {
    throw new RangeError(
      `emergencyFillMonths must be between 1 and 60, received: ${emergencyFillMonths}`,
    );
  }

  const rateIncreaseMaxSurplusShareBps = assertNonNegativeInteger(
    merged.rateIncreaseMaxSurplusShareBps,
    "rateIncreaseMaxSurplusShareBps",
  );
  if (rateIncreaseMaxSurplusShareBps > 10_000) {
    throw new RangeError(
      `rateIncreaseMaxSurplusShareBps must be between 0 and 10000, received: ${rateIncreaseMaxSurplusShareBps}`,
    );
  }

  const normalizedUsed: Record<string, number> = {};
  for (const [loanId, val] of Object.entries(
    merged.specialRepaymentUsedThisYearCentsByLoanId,
  )) {
    normalizedUsed[loanId] = assertNonNegativeInteger(
      val,
      `specialRepaymentUsedThisYearCentsByLoanId[${loanId}]`,
    );
  }

  return {
    emergencyFundMonths,
    etfAnnualReturnBps,
    safetyMarginBps,
    saverAllowanceCents,
    churchTaxBps: churchTaxBps as 0 | 800 | 900,
    shortHorizonMonths,
    savingsBufferBps,
    emergencyFillMonths,
    rateIncreaseMaxSurplusShareBps,
    specialRepaymentUsedThisYearCentsByLoanId: normalizedUsed,
  };
}

export type RecommendationItemKind =
  | "emergency_fund"
  | "pot_deadline"
  | "loan_prepayment"
  | "loan_rate_increase"
  | "loan_reserve"
  | "etf"
  | "keep_liquid";

export type RecommendationTarget =
  | { type: "pot"; potId: string }
  | { type: "loan"; loanId: string }
  | { type: "none" };

export type RecommendationReason =
  | {
      code: "EMERGENCY_FUND_GAP";
      targetCents: number;
      currentCents: number;
      months: number;
      targetSource: "pots" | "rule";
    }
  | { code: "EMERGENCY_FUND_NO_POT" }
  | {
      code: "POT_DEADLINE_GAP";
      targetMonth: string;
      restMonths: number;
      shortfallAtDeadlineCents: number;
      status: PotDeadlineStatus;
    }
  | {
      code: "POT_DEADLINE_UNREACHABLE";
      targetMonth: string;
      remainingGapCents: number;
    }
  | {
      code: "PREPAYMENT_BEATS_ETF";
      interestRateBps: number;
      breakEvenBps: number | null;
      expectedReturnBps: number;
      safetyMarginBps: number;
    }
  | {
      code: "PREPAYMENT_CAP_REACHED";
      capCents: number;
      usedCents: number;
      overflowCents: number;
    }
  | { code: "PREPAYMENT_CAP_UNKNOWN" }
  | {
      code: "FIXED_INTEREST_ENDS_SOON";
      fixedInterestUntil: string;
      monthsUntil: number;
      futureRateBps: number | null;
    }
  | { code: "HORIZON_ESTIMATED"; horizonMonths: number }
  | {
      code: "ETF_BEATS_PREPAYMENT";
      interestRateBps: number;
      breakEvenBps: number;
      expectedReturnBps: number;
      safetyMarginBps: number;
    }
  | { code: "ETF_NO_LOAN" }
  | { code: "ETF_AFTER_LOANS" }
  | { code: "KEEP_LIQUID_NON_POSITIVE_RETURN"; expectedReturnBps: number }
  | { code: "SURPLUS_BUFFER"; bufferBps: number }
  | { code: "EMERGENCY_FUND_MONTHLY"; gapCents: number; fillMonths: number }
  | {
      code: "POT_MONTHLY_REQUIRED";
      requiredMonthlyCents: number;
      targetMonth: string;
    }
  | {
      code: "POT_MONTHLY_INSUFFICIENT";
      requiredMonthlyCents: number;
      allocatedCents: number;
      targetMonth: string;
    }
  | {
      code: "RATE_INCREASE_BEATS_ETF";
      interestRateBps: number;
      breakEvenBps: number | null;
      expectedReturnBps: number;
      safetyMarginBps: number;
      currentMonthlyRateCents: number;
      newMonthlyRateCents: number;
      remainingChangesAfter: number | null;
      latestChangeDate: string | null;
    }
  | { code: "RATE_CHANGE_CORRIDOR_LIMIT"; maxMonthlyCents: number }
  | { code: "RATE_CHANGE_SHARE_LIMIT"; shareBps: number }
  | { code: "RATE_CHANGE_COUNT_UNKNOWN" }
  | {
      code: "PREPAYMENT_CAP_PERCENT_OF_BALANCE";
      percentBps: number;
      capCents: number;
    };

export type RecommendationNote =
  | { code: "AMOUNT_ZERO" }
  | { code: "NO_SURPLUS"; surplusCents: number }
  | {
      code: "EMERGENCY_FUND_FULL";
      currentCents: number;
      targetCents: number;
    }
  | { code: "EMERGENCY_TARGET_UNKNOWN" }
  | { code: "POT_ON_TRACK"; potId: string; targetMonth: string }
  | { code: "POT_NO_DEADLINE_SKIPPED"; potId: string }
  | { code: "LOAN_NO_PREPAYMENT_RIGHT"; loanId: string }
  | { code: "LOAN_RATE_BELOW_INTEREST"; loanId: string }
  | { code: "POT_DUE_ONE_TIME"; potId: string; shortfallCents: number }
  | {
      code: "RATE_DECREASE_POSSIBLE";
      loanId: string;
      currentMonthlyRateCents: number;
      minMonthlyCents: number;
      reliefCents: number;
    }
  | {
      code: "RATE_CHANGE_ALTERNATIVE";
      loanId: string;
      remainingChanges: number | null;
      maxMonthlyCents: number;
    }
  | { code: "RATE_CHANGE_RIGHT_UNKNOWN"; loanId: string }
  | {
      code: "RATE_CHANGE_SKIPPED_FIXED_END_SOON";
      loanId: string;
      fixedInterestUntil: string;
    }
  | {
      code: "SPECIAL_REPAYMENT_AMOUNT_UNKNOWN";
      loanId: string;
      missingOriginalPrincipal: boolean;
    };

export interface RecommendationItem {
  ref: string;
  kind: RecommendationItemKind;
  amountCents: number;
  target: RecommendationTarget;
  reasons: RecommendationReason[];
  currentMonthlyRateCents?: number;
  newMonthlyRateCents?: number;
}

export interface RecommendationResult {
  mode: "one_time" | "monthly";
  amountCents: number;
  items: RecommendationItem[];
  notes: RecommendationNote[];
  assumptions: RecommendationAssumptions;
  loanOrder: string[];
  loanOptionsDigest?: string;
}

type DraftItem = Omit<RecommendationItem, "ref">;

function targetKey(target: RecommendationTarget): string {
  if (target.type === "pot") return `pot:${target.potId}`;
  if (target.type === "loan") return `loan:${target.loanId}`;
  return "none";
}

function getPotAllocatedCents(
  drafts: readonly DraftItem[],
  potId: string,
): number {
  let sum = 0;
  for (const d of drafts) {
    if (d.target.type === "pot" && d.target.potId === potId) {
      sum += d.amountCents;
    }
  }
  return sum;
}

function hasPotHeadroom(
  pot: RecommendationPot,
  amountCents: number,
  drafts: readonly DraftItem[],
): boolean {
  if (pot.targetCents === null) return true;
  const headroom =
    pot.targetCents - pot.currentCents - getPotAllocatedCents(drafts, pot.id);
  return headroom >= amountCents;
}

function pickEmergencyPotForRule(
  emergencyPots: readonly RecommendationPot[],
  amountCents: number,
  drafts: readonly DraftItem[],
): RecommendationPot | undefined {
  return (
    emergencyPots.find((p) => p.targetCents === null) ??
    emergencyPots.find((p) => hasPotHeadroom(p, amountCents, drafts))
  );
}

function addOrMergeItem(drafts: DraftItem[], next: DraftItem): void {
  if (next.amountCents <= 0) return;
  const nextKey = `${next.kind}|${targetKey(next.target)}`;
  const existing = drafts.find(
    (d) => `${d.kind}|${targetKey(d.target)}` === nextKey,
  );
  if (!existing) {
    drafts.push({
      kind: next.kind,
      amountCents: next.amountCents,
      target: next.target,
      reasons: [...next.reasons],
      ...(next.currentMonthlyRateCents !== undefined
        ? { currentMonthlyRateCents: next.currentMonthlyRateCents }
        : {}),
      ...(next.newMonthlyRateCents !== undefined
        ? { newMonthlyRateCents: next.newMonthlyRateCents }
        : {}),
    });
    return;
  }
  existing.amountCents += next.amountCents;
  if (next.newMonthlyRateCents !== undefined) {
    existing.newMonthlyRateCents = next.newMonthlyRateCents;
  }
  for (const r of next.reasons) {
    const serialized = JSON.stringify(r);
    if (!existing.reasons.some((er) => JSON.stringify(er) === serialized)) {
      existing.reasons.push(r);
    }
  }
}

function finalizeItems(
  drafts: DraftItem[],
  expectedSumCents: number,
): RecommendationItem[] {
  const items = drafts
    .filter((d) => d.amountCents > 0)
    .map((d, idx) => ({
      ref: `P${idx + 1}`,
      kind: d.kind,
      amountCents: assertSafeInteger(d.amountCents, `items[${idx}].amountCents`),
      target: d.target,
      reasons: d.reasons,
      ...(d.currentMonthlyRateCents !== undefined
        ? { currentMonthlyRateCents: d.currentMonthlyRateCents }
        : {}),
      ...(d.newMonthlyRateCents !== undefined
        ? { newMonthlyRateCents: d.newMonthlyRateCents }
        : {}),
    }));

  const actualSum = items.reduce((acc, item) => acc + item.amountCents, 0);
  if (actualSum !== expectedSumCents) {
    throw new Error(
      `Recommendation invariant violated: sum(${actualSum}) !== expected(${expectedSumCents})`,
    );
  }
  return items;
}

function resolveLoanSpecialRule(loan: RecommendationLoan): SpecialRepaymentRule {
  if (loan.specialRepaymentRule !== undefined) {
    return loan.specialRepaymentRule;
  }
  if (loan.specialRepaymentMaxYearlyCents === null) {
    return { kind: "unknown" };
  }
  if (loan.specialRepaymentMaxYearlyCents === 0) {
    return { kind: "none" };
  }
  return { kind: "fixed", capCents: loan.specialRepaymentMaxYearlyCents };
}

function computeLoanOptionsDigest(
  loans: readonly RecommendationLoan[],
): string {
  return loans
    .map((loan) => {
      const rule = resolveLoanSpecialRule(loan);
      const rc = loan.rateCorridor;
      const rcPart = rc
        ? `${rc.status}:${rc.minMonthlyCents ?? "n"}:${rc.maxMonthlyCents ?? "n"}:${rc.remainingChanges ?? "n"}:${rc.flags.corridorAssumed ? 1 : 0}:${rc.flags.exhausted ? 1 : 0}:${rc.flags.corridorEmpty ? 1 : 0}`
        : "none";
      const rulePart =
        rule.kind === "fixed"
          ? `fixed:${rule.capCents}`
          : rule.kind === "percent_balance"
            ? `pctbal:${rule.bps}`
            : rule.kind === "allowed_unknown_amount"
              ? `unkamt:${rule.missingOriginalPrincipal ? 1 : 0}`
              : rule.kind;
      return `${loan.id}|${rulePart}|${loan.specialRepaymentUsedThisYearCents ?? 0}|${loan.rateChangeScope ?? "n"}|${rcPart}`;
    })
    .join(";");
}

function collectRateDecreaseNotes(
  sortedLoans: readonly RecommendationLoan[],
  notes: RecommendationNote[],
): void {
  for (const loan of sortedLoans) {
    const rc = loan.rateCorridor;
    if (
      rc != null &&
      rc.status === "allowed" &&
      !rc.flags.corridorAssumed &&
      !rc.flags.exhausted &&
      !rc.flags.corridorEmpty &&
      rc.remainingChanges !== 0 &&
      rc.minMonthlyCents !== null &&
      rc.minMonthlyCents < loan.monthlyRateCents
    ) {
      notes.push({
        code: "RATE_DECREASE_POSSIBLE",
        loanId: loan.id,
        currentMonthlyRateCents: loan.monthlyRateCents,
        minMonthlyCents: rc.minMonthlyCents,
        reliefCents: loan.monthlyRateCents - rc.minMonthlyCents,
      });
    }
  }
}

function isFixedInterestEndingSoon(
  loan: RecommendationLoan,
  asOfDate: string,
): boolean {
  if (loan.fixedInterestUntil == null) return false;
  if (asOfDate > loan.fixedInterestUntil) return false;
  return (
    countRemainingMonths(asOfDate, loan.fixedInterestUntil) <
    FIXED_INTEREST_SOON_MONTHS
  );
}

function effectiveLoanRateBps(
  loan: RecommendationLoan,
  asOfDate: string,
): number {
  if (isFixedInterestEndingSoon(loan, asOfDate)) {
    return loan.futureLoanInterestRateBps ?? loan.interestRateBps;
  }
  return loan.interestRateBps;
}

function sortLoansForRecommendation(
  loans: readonly RecommendationLoan[],
  asOfDate: string,
): RecommendationLoan[] {
  return loans
    .filter((l) => l.balanceCents > 0)
    .slice()
    .sort((a, b) => {
      const rateDiff =
        effectiveLoanRateBps(b, asOfDate) - effectiveLoanRateBps(a, asOfDate);
      if (rateDiff !== 0) return rateDiff;
      return a.id.localeCompare(b.id);
    });
}

function sortPotsByPriority(
  pots: readonly RecommendationPot[],
): RecommendationPot[] {
  return pots.slice().sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority;
    return a.id.localeCompare(b.id);
  });
}

function computeEmergencyFundStatus(
  state: RecommendationState,
  assumptions: RecommendationAssumptions,
): {
  emergencyPots: RecommendationPot[];
  currentCents: number;
  targetCents: number | null;
  targetSource: "pots" | "rule" | null;
} {
  const emergencyPots = sortPotsByPriority(
    state.pots.filter((p) => p.purpose === "emergency_fund"),
  );
  const currentCents = emergencyPots.reduce(
    (acc, p) => acc + Math.max(0, p.currentCents),
    0,
  );

  if (
    emergencyPots.length > 0 &&
    emergencyPots.every((p) => p.targetCents !== null)
  ) {
    const targetCents = emergencyPots.reduce(
      (acc, p) => acc + Math.max(0, p.targetCents!),
      0,
    );
    return {
      emergencyPots,
      currentCents,
      targetCents,
      targetSource: "pots",
    };
  }

  if (state.monthlyExpensesCents !== null) {
    const targetCents = assertNonNegativeInteger(
      Math.max(0, state.monthlyExpensesCents) * assumptions.emergencyFundMonths,
      "emergencyTargetCents",
    );
    return {
      emergencyPots,
      currentCents,
      targetCents,
      targetSource: "rule",
    };
  }

  return {
    emergencyPots,
    currentCents,
    targetCents: null,
    targetSource: null,
  };
}

function allocateRemainder(
  mode: "one_time" | "monthly",
  initialRest: number,
  state: RecommendationState,
  sortedLoans: readonly RecommendationLoan[],
  sortedPots: readonly RecommendationPot[],
  assumptions: RecommendationAssumptions,
  drafts: DraftItem[],
  notes: RecommendationNote[],
): void {
  let rest = initialRest;
  if (rest <= 0) return;

  let lastEtfWinningLoan: {
    interestRateBps: number;
    breakEvenBps: number;
  } | null = null;
  let anyLoanSkippedOrCapped = false;

  const today = parseIsoDate(state.asOfDate, "asOfDate");
  const remainingMonthsInYear = Math.max(1, 12 - today.month + 1);
  const hasEmergencyFundMonthly = drafts.some((d) =>
    d.reasons.some((r) => r.code === "EMERGENCY_FUND_MONTHLY"),
  );
  const maxTotalRateIncreaseCents =
    mode === "monthly" && state.monthlySurplusCents > 0
      ? Number(
          (BigInt(state.monthlySurplusCents) *
            BigInt(assumptions.rateIncreaseMaxSurplusShareBps)) /
            10_000n,
        )
      : 0;
  let allocatedRateIncreasesCents = 0;

  for (const loan of sortedLoans) {
    if (rest <= 0) break;

    const isSoon = isFixedInterestEndingSoon(loan, state.asOfDate);

    if (isSoon && loan.fixedInterestUntil != null) {
      const fixedEnd = loan.fixedInterestUntil;
      const rc = loan.rateCorridor ?? null;
      if (
        mode === "monthly" &&
        rc !== null &&
        rc.status === "allowed" &&
        !rc.flags.corridorAssumed &&
        !rc.flags.exhausted &&
        !rc.flags.corridorEmpty &&
        rc.remainingChanges !== 0 &&
        rc.maxMonthlyCents !== null &&
        rc.maxMonthlyCents > loan.monthlyRateCents
      ) {
        notes.push({
          code: "RATE_CHANGE_SKIPPED_FIXED_END_SOON",
          loanId: loan.id,
          fixedInterestUntil: fixedEnd,
        });
      }

      const monthsUntil = countRemainingMonths(state.asOfDate, fixedEnd);
      const effectiveRateBps =
        loan.futureLoanInterestRateBps ?? loan.interestRateBps;

      // Project remaining debt at fixedInterestUntil without extra prepayments
      let projectedBalanceAtFixedEnd = loan.balanceCents;
      if (monthsUntil > 0) {
        const projSim = simulatePrepaymentVsEtf({
          loan: {
            balanceCents: loan.balanceCents,
            interestRateBps: loan.interestRateBps,
            monthlyRateCents: loan.monthlyRateCents,
            repaymentType: loan.repaymentType,
            specialRepaymentMaxYearlyCents: 0,
          },
          startDate: state.asOfDate,
          horizonEndDate: fixedEnd,
          oneTimeAmountCents: 0,
          monthlyAmountCents: 0,
          saverAllowanceCents: assumptions.saverAllowanceCents,
          churchTaxBps: assumptions.churchTaxBps,
          etfAnnualReturnBps: assumptions.etfAnnualReturnBps,
        });
        projectedBalanceAtFixedEnd = projSim.prepayment.remainingDebtCents;
      }

      const reserveAmount = Math.min(rest, projectedBalanceAtFixedEnd);
      if (reserveAmount <= 0) {
        anyLoanSkippedOrCapped = true;
        continue;
      }

      const horizonEndDate = addMonthsToIsoDate(
        fixedEnd,
        DEFAULT_ESTIMATED_HORIZON_MONTHS,
      );
      const simLoan = {
        balanceCents: projectedBalanceAtFixedEnd,
        interestRateBps: effectiveRateBps,
        monthlyRateCents: loan.monthlyRateCents,
        repaymentType: loan.repaymentType,
        specialRepaymentMaxYearlyCents: null,
      };
      const simInput = {
        loan: simLoan,
        startDate: fixedEnd,
        horizonEndDate,
        oneTimeAmountCents: mode === "one_time" ? reserveAmount : 0,
        monthlyAmountCents: mode === "monthly" ? reserveAmount : 0,
        specialRepaymentUsedThisYearCents: 0,
        saverAllowanceCents: assumptions.saverAllowanceCents,
        churchTaxBps: assumptions.churchTaxBps,
      };

      const breakEven = findBreakEvenReturnBps(simInput);
      const simAtExpected = simulatePrepaymentVsEtf({
        ...simInput,
        etfAnnualReturnBps: assumptions.etfAnnualReturnBps,
      });
      if (simAtExpected.flags.rateBelowInterest) {
        notes.push({ code: "LOAN_RATE_BELOW_INTEREST", loanId: loan.id });
      }

      const etfWins =
        breakEven.kind === "identical" ||
        (breakEven.kind === "bps" &&
          assumptions.etfAnnualReturnBps >=
            breakEven.bps + assumptions.safetyMarginBps);

      if (!etfWins) {
        const linkedPot = sortedPots.find(
          (p) =>
            p.linkedContractId === loan.id &&
            hasPotHeadroom(p, reserveAmount, drafts),
        );
        const target: RecommendationTarget = linkedPot
          ? { type: "pot", potId: linkedPot.id }
          : { type: "none" };
        addOrMergeItem(drafts, {
          kind: "loan_reserve",
          amountCents: reserveAmount,
          target,
          reasons: [
            {
              code: "FIXED_INTEREST_ENDS_SOON",
              fixedInterestUntil: fixedEnd,
              monthsUntil,
              futureRateBps: loan.futureLoanInterestRateBps,
            },
            {
              code: "PREPAYMENT_BEATS_ETF",
              interestRateBps: effectiveRateBps,
              breakEvenBps: breakEven.kind === "bps" ? breakEven.bps : null,
              expectedReturnBps: assumptions.etfAnnualReturnBps,
              safetyMarginBps: assumptions.safetyMarginBps,
            },
          ],
        });
        rest -= reserveAmount;
        if (rest > 0) {
          anyLoanSkippedOrCapped = true;
        }
      } else {
        if (breakEven.kind === "bps") {
          lastEtfWinningLoan = {
            interestRateBps: effectiveRateBps,
            breakEvenBps: breakEven.bps,
          };
        }
      }
      continue;
    }

    // Normal case (not ending soon)
    const rule = resolveLoanSpecialRule(loan);
    const cap =
      loan.specialRepaymentRule !== undefined
        ? resolveYearlyCapCents(rule, loan.balanceCents)
        : loan.specialRepaymentMaxYearlyCents;

    if (rule.kind === "allowed_unknown_amount") {
      notes.push({
        code: "SPECIAL_REPAYMENT_AMOUNT_UNKNOWN",
        loanId: loan.id,
        missingOriginalPrincipal: rule.missingOriginalPrincipal,
      });
    }

    const horizonEstimated =
      loan.fixedInterestUntil == null ||
      loan.fixedInterestUntil <= state.asOfDate;
    const horizonEndDate = horizonEstimated
      ? addMonthsToIsoDate(state.asOfDate, DEFAULT_ESTIMATED_HORIZON_MONTHS)
      : loan.fixedInterestUntil!;

    const usedThisYear =
      assumptions.specialRepaymentUsedThisYearCentsByLoanId[loan.id] ??
      loan.specialRepaymentUsedThisYearCents ??
      0;

    let specialCappedOrUnavailable = false;
    let specialEvaluatedLoanWins: boolean | null = null;
    let rateBelowInterestNoted = false;

    if (rule.kind === "none" || cap === 0) {
      notes.push({ code: "LOAN_NO_PREPAYMENT_RIGHT", loanId: loan.id });
      anyLoanSkippedOrCapped = true;
      specialCappedOrUnavailable = true;
    } else {
      const annualRoom =
        cap === null ? Number.MAX_SAFE_INTEGER : Math.max(0, cap - usedThisYear);
      const effectiveRoom =
        mode === "one_time" || cap === null
          ? annualRoom
          : Math.floor(annualRoom / remainingMonthsInYear);

      if (effectiveRoom <= 0) {
        anyLoanSkippedOrCapped = true;
        specialCappedOrUnavailable = true;
      } else {
        const amount = Math.min(rest, effectiveRoom, loan.balanceCents);
        if (amount <= 0) {
          anyLoanSkippedOrCapped = true;
          specialCappedOrUnavailable = true;
        } else {
          const simLoan = {
            balanceCents: loan.balanceCents,
            interestRateBps: loan.interestRateBps,
            monthlyRateCents: loan.monthlyRateCents,
            repaymentType: loan.repaymentType,
            specialRepaymentMaxYearlyCents: cap,
            specialRepaymentRule: rule,
          };
          const simInput = {
            loan: simLoan,
            startDate: state.asOfDate,
            horizonEndDate,
            oneTimeAmountCents: mode === "one_time" ? amount : 0,
            monthlyAmountCents: mode === "monthly" ? amount : 0,
            specialRepaymentUsedThisYearCents: usedThisYear,
            saverAllowanceCents: assumptions.saverAllowanceCents,
            churchTaxBps: assumptions.churchTaxBps,
          };

          const breakEven = findBreakEvenReturnBps(simInput);
          const simAtExpected = simulatePrepaymentVsEtf({
            ...simInput,
            etfAnnualReturnBps: assumptions.etfAnnualReturnBps,
          });
          if (simAtExpected.flags.rateBelowInterest) {
            notes.push({ code: "LOAN_RATE_BELOW_INTEREST", loanId: loan.id });
            rateBelowInterestNoted = true;
          }

          const etfWins =
            breakEven.kind === "identical" ||
            (breakEven.kind === "bps" &&
              assumptions.etfAnnualReturnBps >=
                breakEven.bps + assumptions.safetyMarginBps);

          specialEvaluatedLoanWins = !etfWins;

          if (!etfWins) {
            const reasons: RecommendationReason[] = [
              {
                code: "PREPAYMENT_BEATS_ETF",
                interestRateBps: loan.interestRateBps,
                breakEvenBps: breakEven.kind === "bps" ? breakEven.bps : null,
                expectedReturnBps: assumptions.etfAnnualReturnBps,
                safetyMarginBps: assumptions.safetyMarginBps,
              },
            ];
            if (rule.kind === "percent_balance" && cap !== null) {
              reasons.push({
                code: "PREPAYMENT_CAP_PERCENT_OF_BALANCE",
                percentBps: rule.bps,
                capCents: cap,
              });
            }
            if (cap === null) {
              reasons.push({ code: "PREPAYMENT_CAP_UNKNOWN" });
            }
            if (horizonEstimated) {
              reasons.push({
                code: "HORIZON_ESTIMATED",
                horizonMonths: DEFAULT_ESTIMATED_HORIZON_MONTHS,
              });
            }
            if (cap !== null && rest > amount && amount === effectiveRoom) {
              reasons.push({
                code: "PREPAYMENT_CAP_REACHED",
                capCents: cap,
                usedCents: usedThisYear,
                overflowCents: rest - amount,
              });
              specialCappedOrUnavailable = true;
            }
            addOrMergeItem(drafts, {
              kind: "loan_prepayment",
              amountCents: amount,
              target: { type: "loan", loanId: loan.id },
              reasons,
            });
            rest -= amount;
            if (rest > 0) {
              anyLoanSkippedOrCapped = true;
            }
          } else {
            if (breakEven.kind === "bps") {
              lastEtfWinningLoan = {
                interestRateBps: loan.interestRateBps,
                breakEvenBps: breakEven.bps,
              };
            }
          }
        }
      }
    }

    // Step 2: Rate increase (monthly mode) or rate-change note (one_time / unknown)
    const corridor = loan.rateCorridor ?? null;
    if (rest > 0 && corridor !== null) {
      if (mode === "monthly") {
        if (corridor.status === "unknown") {
          let wouldWin = specialEvaluatedLoanWins;
          if (wouldWin === null) {
            const probeAmount = Math.min(rest, loan.balanceCents);
            if (probeAmount > 0) {
              const rateBe = findBreakEvenReturnBps({
                loan: {
                  balanceCents: loan.balanceCents,
                  interestRateBps: loan.interestRateBps,
                  monthlyRateCents: loan.monthlyRateCents,
                  repaymentType: loan.repaymentType,
                  specialRepaymentMaxYearlyCents: cap,
                  specialRepaymentRule: rule,
                },
                startDate: state.asOfDate,
                horizonEndDate,
                oneTimeAmountCents: 0,
                monthlyAmountCents: probeAmount,
                monthlyChannel: "rate_increase",
                monthlyStartMonth: 1,
                saverAllowanceCents: assumptions.saverAllowanceCents,
                churchTaxBps: assumptions.churchTaxBps,
              });
              const etfWinsProbe =
                rateBe.kind === "identical" ||
                (rateBe.kind === "bps" &&
                  assumptions.etfAnnualReturnBps >=
                    rateBe.bps + assumptions.safetyMarginBps);
              wouldWin = !etfWinsProbe;
            }
          }
          if (wouldWin) {
            notes.push({ code: "RATE_CHANGE_RIGHT_UNKNOWN", loanId: loan.id });
          }
        } else if (
          corridor.status === "allowed" &&
          !corridor.flags.corridorAssumed &&
          !corridor.flags.exhausted &&
          !corridor.flags.corridorEmpty &&
          corridor.remainingChanges !== 0 &&
          corridor.maxMonthlyCents !== null &&
          corridor.maxMonthlyCents > loan.monthlyRateCents &&
          !hasEmergencyFundMonthly
        ) {
          const corridorHeadroom =
            corridor.maxMonthlyCents - loan.monthlyRateCents;
          const shareHeadroom = Math.max(
            0,
            maxTotalRateIncreaseCents - allocatedRateIncreasesCents,
          );
          const rawIncrease = Math.min(rest, corridorHeadroom, shareHeadroom);
          const steppedIncrease =
            Math.floor(rawIncrease / RATE_INCREASE_STEP_CENTS) *
            RATE_INCREASE_STEP_CENTS;

          if (steppedIncrease > 0) {
            const rateSimInput = {
              loan: {
                balanceCents: loan.balanceCents,
                interestRateBps: loan.interestRateBps,
                monthlyRateCents: loan.monthlyRateCents,
                repaymentType: loan.repaymentType,
                specialRepaymentMaxYearlyCents: cap,
                specialRepaymentRule: rule,
              },
              startDate: state.asOfDate,
              horizonEndDate,
              oneTimeAmountCents: 0,
              monthlyAmountCents: steppedIncrease,
              monthlyChannel: "rate_increase" as const,
              monthlyStartMonth: 1,
              saverAllowanceCents: assumptions.saverAllowanceCents,
              churchTaxBps: assumptions.churchTaxBps,
            };
            const rateBreakEven = findBreakEvenReturnBps(rateSimInput);
            if (!rateBelowInterestNoted) {
              const rateSimAtExpected = simulatePrepaymentVsEtf({
                ...rateSimInput,
                etfAnnualReturnBps: assumptions.etfAnnualReturnBps,
              });
              if (rateSimAtExpected.flags.rateBelowInterest) {
                notes.push({
                  code: "LOAN_RATE_BELOW_INTEREST",
                  loanId: loan.id,
                });
              }
            }

            const etfWinsRate =
              rateBreakEven.kind === "identical" ||
              (rateBreakEven.kind === "bps" &&
                assumptions.etfAnnualReturnBps >=
                  rateBreakEven.bps + assumptions.safetyMarginBps);

            if (!etfWinsRate) {
              const newMonthlyRateCents =
                loan.monthlyRateCents + steppedIncrease;
              const remainingChangesAfter =
                corridor.remainingChanges !== null
                  ? corridor.flags.perYearUsageUntracked
                    ? corridor.remainingChanges
                    : Math.max(0, corridor.remainingChanges - 1)
                  : null;
              const reasons: RecommendationReason[] = [
                {
                  code: "RATE_INCREASE_BEATS_ETF",
                  interestRateBps: loan.interestRateBps,
                  breakEvenBps:
                    rateBreakEven.kind === "bps" ? rateBreakEven.bps : null,
                  expectedReturnBps: assumptions.etfAnnualReturnBps,
                  safetyMarginBps: assumptions.safetyMarginBps,
                  currentMonthlyRateCents: loan.monthlyRateCents,
                  newMonthlyRateCents,
                  remainingChangesAfter,
                  latestChangeDate: corridor.latestChangeDate,
                },
              ];
              if (corridorHeadroom < rest && rawIncrease === corridorHeadroom) {
                reasons.push({
                  code: "RATE_CHANGE_CORRIDOR_LIMIT",
                  maxMonthlyCents: corridor.maxMonthlyCents,
                });
              }
              if (shareHeadroom < rest && rawIncrease === shareHeadroom) {
                reasons.push({
                  code: "RATE_CHANGE_SHARE_LIMIT",
                  shareBps: assumptions.rateIncreaseMaxSurplusShareBps,
                });
              }
              if (corridor.remainingChanges === null) {
                reasons.push({ code: "RATE_CHANGE_COUNT_UNKNOWN" });
              }
              if (horizonEstimated) {
                reasons.push({
                  code: "HORIZON_ESTIMATED",
                  horizonMonths: DEFAULT_ESTIMATED_HORIZON_MONTHS,
                });
              }
              addOrMergeItem(drafts, {
                kind: "loan_rate_increase",
                amountCents: steppedIncrease,
                target: { type: "loan", loanId: loan.id },
                currentMonthlyRateCents: loan.monthlyRateCents,
                newMonthlyRateCents,
                reasons,
              });
              rest -= steppedIncrease;
              allocatedRateIncreasesCents += steppedIncrease;
              if (rest > 0) {
                anyLoanSkippedOrCapped = true;
              }
            } else if (
              rateBreakEven.kind === "bps" &&
              lastEtfWinningLoan === null
            ) {
              lastEtfWinningLoan = {
                interestRateBps: loan.interestRateBps,
                breakEvenBps: rateBreakEven.bps,
              };
            }
          }
        }
      } else if (
        mode === "one_time" &&
        specialCappedOrUnavailable &&
        corridor.status === "allowed" &&
        !corridor.flags.corridorAssumed &&
        !corridor.flags.exhausted &&
        !corridor.flags.corridorEmpty &&
        corridor.remainingChanges !== 0 &&
        corridor.maxMonthlyCents !== null &&
        corridor.maxMonthlyCents > loan.monthlyRateCents
      ) {
        let loanWins = specialEvaluatedLoanWins;
        if (loanWins === null) {
          const probeMonthly = Math.min(
            10_000,
            corridor.maxMonthlyCents - loan.monthlyRateCents,
          );
          if (probeMonthly > 0) {
            const rateBe = findBreakEvenReturnBps({
              loan: {
                balanceCents: loan.balanceCents,
                interestRateBps: loan.interestRateBps,
                monthlyRateCents: loan.monthlyRateCents,
                repaymentType: loan.repaymentType,
                specialRepaymentMaxYearlyCents: cap,
                specialRepaymentRule: rule,
              },
              startDate: state.asOfDate,
              horizonEndDate,
              oneTimeAmountCents: 0,
              monthlyAmountCents: probeMonthly,
              monthlyChannel: "rate_increase",
              monthlyStartMonth: 1,
              saverAllowanceCents: assumptions.saverAllowanceCents,
              churchTaxBps: assumptions.churchTaxBps,
            });
            const etfWinsProbe =
              rateBe.kind === "identical" ||
              (rateBe.kind === "bps" &&
                assumptions.etfAnnualReturnBps >=
                  rateBe.bps + assumptions.safetyMarginBps);
            loanWins = !etfWinsProbe;
          }
        }
        if (loanWins) {
          notes.push({
            code: "RATE_CHANGE_ALTERNATIVE",
            loanId: loan.id,
            remainingChanges: corridor.remainingChanges,
            maxMonthlyCents: corridor.maxMonthlyCents,
          });
        }
      }
    }
  }

  if (rest > 0) {
    if (assumptions.etfAnnualReturnBps <= 0) {
      addOrMergeItem(drafts, {
        kind: "keep_liquid",
        amountCents: rest,
        target: { type: "none" },
        reasons: [
          {
            code: "KEEP_LIQUID_NON_POSITIVE_RETURN",
            expectedReturnBps: assumptions.etfAnnualReturnBps,
          },
        ],
      });
    } else {
      const etfReason: RecommendationReason = lastEtfWinningLoan
        ? {
            code: "ETF_BEATS_PREPAYMENT",
            interestRateBps: lastEtfWinningLoan.interestRateBps,
            breakEvenBps: lastEtfWinningLoan.breakEvenBps,
            expectedReturnBps: assumptions.etfAnnualReturnBps,
            safetyMarginBps: assumptions.safetyMarginBps,
          }
        : sortedLoans.length === 0 || !anyLoanSkippedOrCapped
          ? sortedLoans.length === 0
            ? { code: "ETF_NO_LOAN" }
            : { code: "ETF_AFTER_LOANS" }
          : { code: "ETF_AFTER_LOANS" };

      const alreadyAllocatedByPot = new Map<string, number>();
      for (const d of drafts) {
        if (d.target.type === "pot") {
          alreadyAllocatedByPot.set(
            d.target.potId,
            (alreadyAllocatedByPot.get(d.target.potId) ?? 0) + d.amountCents,
          );
        }
      }

      const investmentPot = sortedPots.find((p) => {
        if (p.purpose !== "investment") return false;
        if (p.targetCents === null) return true;
        const used = alreadyAllocatedByPot.get(p.id) ?? 0;
        const headroom = p.targetCents - p.currentCents - used;
        return headroom >= rest;
      });

      addOrMergeItem(drafts, {
        kind: "etf",
        amountCents: rest,
        target: investmentPot
          ? { type: "pot", potId: investmentPot.id }
          : { type: "none" },
        reasons: [etfReason],
      });
    }
  }
}

export function recommendUse(
  amountCents: number,
  state: RecommendationState,
  assumptionsInput?: Partial<RecommendationAssumptions>,
): RecommendationResult {
  const safeAmount = assertNonNegativeInteger(amountCents, "amountCents");
  parseIsoDate(state.asOfDate, "asOfDate");
  const assumptions = validateRecommendationAssumptions(assumptionsInput);
  const sortedLoans = sortLoansForRecommendation(state.loans, state.asOfDate);
  const loanOrder = sortedLoans.map((l) => l.id);
  const sortedPots = sortPotsByPriority(state.pots);

  if (safeAmount === 0) {
    return {
      mode: "one_time",
      amountCents: 0,
      items: [],
      notes: [{ code: "AMOUNT_ZERO" }],
      assumptions,
      loanOrder,
    };
  }

  const drafts: DraftItem[] = [];
  const notes: RecommendationNote[] = [];
  let rest = safeAmount;

  // 1. Notgroschen
  const ef = computeEmergencyFundStatus(state, assumptions);
  if (ef.targetCents === null || ef.targetSource === null) {
    notes.push({ code: "EMERGENCY_TARGET_UNKNOWN" });
  } else {
    const gap = Math.max(0, ef.targetCents - ef.currentCents);
    if (gap === 0) {
      notes.push({
        code: "EMERGENCY_FUND_FULL",
        currentCents: ef.currentCents,
        targetCents: ef.targetCents,
      });
    } else if (rest > 0) {
      const alloc = Math.min(rest, gap);
      const gapReason: RecommendationReason = {
        code: "EMERGENCY_FUND_GAP",
        targetCents: ef.targetCents,
        currentCents: ef.currentCents,
        months: assumptions.emergencyFundMonths,
        targetSource: ef.targetSource,
      };
      if (ef.targetSource === "pots") {
        let remainingAlloc = alloc;
        for (const pot of ef.emergencyPots) {
          if (remainingAlloc <= 0) break;
          const potGap = Math.max(0, pot.targetCents! - pot.currentCents);
          const potAlloc = Math.min(remainingAlloc, potGap);
          if (potAlloc > 0) {
            addOrMergeItem(drafts, {
              kind: "emergency_fund",
              amountCents: potAlloc,
              target: { type: "pot", potId: pot.id },
              reasons: [gapReason],
            });
            remainingAlloc -= potAlloc;
          }
        }
      } else if (ef.emergencyPots.length > 0) {
        const targetPot = pickEmergencyPotForRule(
          ef.emergencyPots,
          alloc,
          drafts,
        );
        addOrMergeItem(drafts, {
          kind: "emergency_fund",
          amountCents: alloc,
          target: targetPot
            ? { type: "pot", potId: targetPot.id }
            : { type: "none" },
          reasons: [gapReason],
        });
      } else {
        addOrMergeItem(drafts, {
          kind: "emergency_fund",
          amountCents: alloc,
          target: { type: "none" },
          reasons: [gapReason, { code: "EMERGENCY_FUND_NO_POT" }],
        });
      }
      rest -= alloc;
    }
  }

  // 2. Ziel-Töpfe mit nahem Termin
  for (const pot of sortedPots) {
    if (
      pot.targetDate == null &&
      pot.targetCents !== null &&
      pot.purpose !== "emergency_fund" &&
      pot.purpose !== "investment"
    ) {
      notes.push({ code: "POT_NO_DEADLINE_SKIPPED", potId: pot.id });
    }
  }

  const potById = new Map(sortedPots.map((p) => [p.id, p]));
  const deadlineEvals = evaluatePotDeadlines({
    pots: sortedPots,
    monthlySurplusCents: state.monthlySurplusCents,
    todayIsoDate: state.asOfDate,
  })
    .filter(
      (ev) =>
        ev.restMonths <= assumptions.shortHorizonMonths ||
        ev.status === "overdue",
    )
    .sort((a, b) => {
      if (a.targetDate !== b.targetDate) {
        return a.targetDate.localeCompare(b.targetDate);
      }
      const pA = potById.get(a.potId)?.priority ?? 0;
      const pB = potById.get(b.potId)?.priority ?? 0;
      if (pA !== pB) return pA - pB;
      return a.potId.localeCompare(b.potId);
    });

  for (const ev of deadlineEvals) {
    if (potById.get(ev.potId)?.purpose === "emergency_fund") {
      continue;
    }
    const rawNeed =
      ev.status === "overdue" ? ev.shortfallNowCents : ev.shortfallAtDeadlineCents;
    const need = Math.max(0, rawNeed - getPotAllocatedCents(drafts, ev.potId));
    if (need <= 0) {
      notes.push({
        code: "POT_ON_TRACK",
        potId: ev.potId,
        targetMonth: ev.targetMonth,
      });
      continue;
    }
    if (rest <= 0) continue;
    const alloc = Math.min(rest, need);
    const reasons: RecommendationReason[] = [
      {
        code: "POT_DEADLINE_GAP",
        targetMonth: ev.targetMonth,
        restMonths: ev.restMonths,
        shortfallAtDeadlineCents: need,
        status: ev.status,
      },
    ];
    if (alloc < need) {
      reasons.push({
        code: "POT_DEADLINE_UNREACHABLE",
        targetMonth: ev.targetMonth,
        remainingGapCents: need - alloc,
      });
    }
    addOrMergeItem(drafts, {
      kind: "pot_deadline",
      amountCents: alloc,
      target: { type: "pot", potId: ev.potId },
      reasons,
    });
    rest -= alloc;
  }

  // 3. & 4. Sondertilgung vs. ETF / Rest
  allocateRemainder(
    "one_time",
    rest,
    state,
    sortedLoans,
    sortedPots,
    assumptions,
    drafts,
    notes,
  );

  const loanOptionsDigest = computeLoanOptionsDigest(sortedLoans);

  return {
    mode: "one_time",
    amountCents: safeAmount,
    items: finalizeItems(drafts, safeAmount),
    notes,
    assumptions,
    loanOrder,
    loanOptionsDigest,
  };
}

export function recommendMonthlySavings(
  state: RecommendationState,
  assumptionsInput?: Partial<RecommendationAssumptions>,
): RecommendationResult {
  parseIsoDate(state.asOfDate, "asOfDate");
  const surplus = assertSafeInteger(
    state.monthlySurplusCents,
    "monthlySurplusCents",
  );
  const assumptions = validateRecommendationAssumptions(assumptionsInput);
  const sortedLoans = sortLoansForRecommendation(state.loans, state.asOfDate);
  const loanOrder = sortedLoans.map((l) => l.id);
  const loanOptionsDigest = computeLoanOptionsDigest(sortedLoans);
  const sortedPots = sortPotsByPriority(state.pots);

  if (surplus <= 0) {
    const notes: RecommendationNote[] = [
      { code: "NO_SURPLUS", surplusCents: surplus },
    ];
    collectRateDecreaseNotes(sortedLoans, notes);
    return {
      mode: "monthly",
      amountCents: 0,
      items: [],
      notes,
      assumptions,
      loanOrder,
      loanOptionsDigest,
    };
  }

  const drafts: DraftItem[] = [];
  const notes: RecommendationNote[] = [];

  const buffer = Number(
    (BigInt(surplus) * BigInt(assumptions.savingsBufferBps)) / 10_000n,
  );
  if (buffer > 0) {
    addOrMergeItem(drafts, {
      kind: "keep_liquid",
      amountCents: buffer,
      target: { type: "none" },
      reasons: [
        { code: "SURPLUS_BUFFER", bufferBps: assumptions.savingsBufferBps },
      ],
    });
  }

  let rest = surplus - buffer;

  // 1. Notgroschen monatlich
  const ef = computeEmergencyFundStatus(state, assumptions);
  if (ef.targetCents === null || ef.targetSource === null) {
    notes.push({ code: "EMERGENCY_TARGET_UNKNOWN" });
  } else {
    const gap = Math.max(0, ef.targetCents - ef.currentCents);
    if (gap === 0) {
      notes.push({
        code: "EMERGENCY_FUND_FULL",
        currentCents: ef.currentCents,
        targetCents: ef.targetCents,
      });
    } else {
      collectRateDecreaseNotes(sortedLoans, notes);
      if (rest > 0) {
        const monthlyNeeded = calculateRequiredMonthlyCents(
          gap,
          assumptions.emergencyFillMonths,
        );
        const alloc = Math.min(rest, monthlyNeeded);
        const reason: RecommendationReason = {
          code: "EMERGENCY_FUND_MONTHLY",
          gapCents: gap,
          fillMonths: assumptions.emergencyFillMonths,
        };
        if (ef.targetSource === "pots") {
          let remainingAlloc = alloc;
          for (const pot of ef.emergencyPots) {
            if (remainingAlloc <= 0) break;
            const potGap = Math.max(0, pot.targetCents! - pot.currentCents);
            const potMonthly = calculateRequiredMonthlyCents(
              potGap,
              assumptions.emergencyFillMonths,
            );
            const potAlloc = Math.min(remainingAlloc, potMonthly);
            if (potAlloc > 0) {
              addOrMergeItem(drafts, {
                kind: "emergency_fund",
                amountCents: potAlloc,
                target: { type: "pot", potId: pot.id },
                reasons: [reason],
              });
              remainingAlloc -= potAlloc;
            }
          }
        } else if (ef.emergencyPots.length > 0) {
          const targetPot = pickEmergencyPotForRule(
            ef.emergencyPots,
            alloc,
            drafts,
          );
          addOrMergeItem(drafts, {
            kind: "emergency_fund",
            amountCents: alloc,
            target: targetPot
              ? { type: "pot", potId: targetPot.id }
              : { type: "none" },
            reasons: [reason],
          });
        } else {
          addOrMergeItem(drafts, {
            kind: "emergency_fund",
            amountCents: alloc,
            target: { type: "none" },
            reasons: [reason, { code: "EMERGENCY_FUND_NO_POT" }],
          });
        }
        rest -= alloc;
      }
    }
  }

  // 2. Termin-Töpfe (alle Termine mit restMonths >= 1)
  const potById = new Map(sortedPots.map((p) => [p.id, p]));
  const deadlineEvals = evaluatePotDeadlines({
    pots: sortedPots,
    monthlySurplusCents: 0,
    todayIsoDate: state.asOfDate,
  }).sort((a, b) => {
    if (a.targetDate !== b.targetDate) {
      return a.targetDate.localeCompare(b.targetDate);
    }
    const pA = potById.get(a.potId)?.priority ?? 0;
    const pB = potById.get(b.potId)?.priority ?? 0;
    if (pA !== pB) return pA - pB;
    return a.potId.localeCompare(b.potId);
  });

  for (const ev of deadlineEvals) {
    if (potById.get(ev.potId)?.purpose === "emergency_fund") {
      continue;
    }
    const alreadyAllocated = getPotAllocatedCents(drafts, ev.potId);
    if (ev.shortfallNowCents - alreadyAllocated <= 0) {
      notes.push({
        code: "POT_ON_TRACK",
        potId: ev.potId,
        targetMonth: ev.targetMonth,
      });
      continue;
    }
    if (ev.restMonths === 0) {
      notes.push({
        code: "POT_DUE_ONE_TIME",
        potId: ev.potId,
        shortfallCents: ev.shortfallNowCents - alreadyAllocated,
      });
      continue;
    }
    if (rest <= 0) continue;
    const needed = Math.max(0, ev.requiredMonthlyCents - alreadyAllocated);
    if (needed <= 0) continue;
    const alloc = Math.min(rest, needed);
    const reasons: RecommendationReason[] = [
      {
        code: "POT_MONTHLY_REQUIRED",
        requiredMonthlyCents: needed,
        targetMonth: ev.targetMonth,
      },
    ];
    if (alloc < needed) {
      reasons.push({
        code: "POT_MONTHLY_INSUFFICIENT",
        requiredMonthlyCents: needed,
        allocatedCents: alloc,
        targetMonth: ev.targetMonth,
      });
    }
    addOrMergeItem(drafts, {
      kind: "pot_deadline",
      amountCents: alloc,
      target: { type: "pot", potId: ev.potId },
      reasons,
    });
    rest -= alloc;
  }

  // 3. & 4. Rest monatlich
  allocateRemainder(
    "monthly",
    rest,
    state,
    sortedLoans,
    sortedPots,
    assumptions,
    drafts,
    notes,
  );

  return {
    mode: "monthly",
    amountCents: surplus,
    items: finalizeItems(drafts, surplus),
    notes,
    assumptions,
    loanOrder,
    loanOptionsDigest,
  };
}

export function computeRecommendationFingerprint(
  result: Pick<
    RecommendationResult,
    "mode" | "amountCents" | "items" | "loanOptionsDigest"
  >,
): string {
  const itemParts = result.items.map((item) => {
    const targetId =
      item.target.type === "pot"
        ? item.target.potId
        : item.target.type === "loan"
          ? item.target.loanId
          : "none";
    const ratePart =
      item.newMonthlyRateCents !== undefined
        ? `@${item.currentMonthlyRateCents ?? 0}->${item.newMonthlyRateCents}`
        : "";
    return `${item.ref}:${item.kind}:${targetId}:${item.amountCents}${ratePart}`;
  });
  const parts = [result.mode, String(result.amountCents), ...itemParts];
  if (result.loanOptionsDigest) {
    parts.push(`loans:${result.loanOptionsDigest}`);
  }
  return parts.join("|");
}
