/** Eingaben, Annahmen und Ergebnis-Typen der Empfehlungslogik (Topf-, Kredit- und ETF-Verwendung). */
import { type RepaymentType } from "@/domain/contracts/contract";
import type {
  RateChangeScope, RateCorridor, SpecialRepaymentRule,
} from "@/domain/contracts/loan-options";
import { assertNonNegativeInteger, assertSafeInteger } from "@/domain/core/money";
import { type PotDeadlineStatus } from "@/domain/allocation/pot-deadline";
import {
  ALLOWED_CHURCH_TAX_BPS, DEFAULT_SAVER_ALLOWANCE_CENTS, MAX_ETF_RETURN_BPS,
  MAX_SAVER_ALLOWANCE_CENTS, MIN_ETF_RETURN_BPS,
} from "@/domain/planning/etf";
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
