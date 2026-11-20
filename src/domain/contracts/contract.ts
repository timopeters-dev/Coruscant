import {
  countCompletedMonths,
  diffCalendarDays,
  parseIsoDate,
} from "@/domain/core/date";
import { getLoanOptions, type OptionRight, type RateChangeScope, type SpecialRepaymentBasis } from "./loan-options";
import { validateLoanOptions } from "./loan-options-validation";
import {
  assertNonNegativeInteger,
  assertSafeInteger,
  roundHalfUpBigInt,
} from "@/domain/core/money";

export type ContractCategory = "loan" | "savings_contract";
export type ContractStatus = "active" | "paused" | "closed";
export type RepaymentType = "annuity" | "installment" | "lump_sum";

export interface DomainContract {
  id: string;
  name: string;
  category: ContractCategory;
  status: ContractStatus;
  currentBalanceCents: number;
  balanceAsOfDate: string;
  monthlyRateCents: number;
  interestRateBps: number;
  repaymentType?: RepaymentType | null;
  milestoneDate?: string | null;
  milestoneLabel?: string | null;
  fixedInterestUntil?: string | null;
  targetSumCents?: number | null;
  allocationThresholdPercent?: number | null;
  specialRepaymentMaxYearlyCents?: number | null;
  originalPrincipalCents?: number | null;
  specialRepaymentRight?: OptionRight | null;
  specialRepaymentBasis?: SpecialRepaymentBasis | null;
  specialRepaymentPercentBps?: number | null;
  specialRepaymentUsedCents?: number | null;
  specialRepaymentUsedYear?: number | null;
  rateChangeRight?: OptionRight | null;
  rateChangeTotalCount?: number | null;
  rateChangeScope?: RateChangeScope | null;
  rateChangeUsedCount?: number | null;
  rateChangeMinRepaymentBps?: number | null;
  rateChangeMaxRepaymentBps?: number | null;
  rateChangeMinMonthlyCents?: number | null;
  rateChangeMaxMonthlyCents?: number | null;
  loanOptionsNote?: string | null;
}

/**
 * Structural contract record shape satisfied by FinancialContractRow (DB/API)
 * without importing DB types into the domain layer.
 */
export interface ContractRecordLike {
  id: string;
  name: string;
  category: ContractCategory;
  status: ContractStatus;
  currentBalanceCents: number;
  balanceAsOfDate: string;
  monthlyRateCents: number;
  interestRateBps: number;
  repaymentType?: RepaymentType | null;
  milestoneDate?: string | null;
  milestoneLabel?: string | null;
  fixedInterestUntil?: string | null;
  targetSumCents?: number | null;
  allocationThresholdPercent?: number | null;
  specialRepaymentMaxYearlyCents?: number | null;
  originalPrincipalCents?: number | null;
  specialRepaymentRight?: OptionRight | null;
  specialRepaymentBasis?: SpecialRepaymentBasis | null;
  specialRepaymentPercentBps?: number | null;
  specialRepaymentUsedCents?: number | null;
  specialRepaymentUsedYear?: number | null;
  rateChangeRight?: OptionRight | null;
  rateChangeTotalCount?: number | null;
  rateChangeScope?: RateChangeScope | null;
  rateChangeUsedCount?: number | null;
  rateChangeMinRepaymentBps?: number | null;
  rateChangeMaxRepaymentBps?: number | null;
  rateChangeMinMonthlyCents?: number | null;
  rateChangeMaxMonthlyCents?: number | null;
  loanOptionsNote?: string | null;
}

/**
 * Single authoritative mapper from persisted/API contract records to DomainContract.
 */
export function contractRecordToDomain(
  record: ContractRecordLike,
): DomainContract {
  return {
    id: record.id,
    name: record.name,
    category: record.category,
    status: record.status,
    currentBalanceCents: record.currentBalanceCents,
    balanceAsOfDate: record.balanceAsOfDate,
    monthlyRateCents: record.monthlyRateCents,
    interestRateBps: record.interestRateBps,
    repaymentType: record.repaymentType ?? null,
    milestoneDate: record.milestoneDate ?? null,
    milestoneLabel: record.milestoneLabel ?? null,
    fixedInterestUntil: record.fixedInterestUntil ?? null,
    targetSumCents: record.targetSumCents ?? null,
    allocationThresholdPercent: record.allocationThresholdPercent ?? null,
    specialRepaymentMaxYearlyCents:
      record.specialRepaymentMaxYearlyCents ?? null,
    originalPrincipalCents: record.originalPrincipalCents ?? null,
    specialRepaymentRight: record.specialRepaymentRight ?? null,
    specialRepaymentBasis: record.specialRepaymentBasis ?? null,
    specialRepaymentPercentBps: record.specialRepaymentPercentBps ?? null,
    specialRepaymentUsedCents: record.specialRepaymentUsedCents ?? null,
    specialRepaymentUsedYear: record.specialRepaymentUsedYear ?? null,
    rateChangeRight: record.rateChangeRight ?? null,
    rateChangeTotalCount: record.rateChangeTotalCount ?? null,
    rateChangeScope: record.rateChangeScope ?? null,
    rateChangeUsedCount: record.rateChangeUsedCount ?? null,
    rateChangeMinRepaymentBps: record.rateChangeMinRepaymentBps ?? null,
    rateChangeMaxRepaymentBps: record.rateChangeMaxRepaymentBps ?? null,
    rateChangeMinMonthlyCents: record.rateChangeMinMonthlyCents ?? null,
    rateChangeMaxMonthlyCents: record.rateChangeMaxMonthlyCents ?? null,
    loanOptionsNote: record.loanOptionsNote ?? null,
  };
}

export interface ContractStepInput {
  category: ContractCategory;
  repaymentType?: RepaymentType | null;
  monthlyRateCents: number;
  interestRateBps: number;
}

export interface ContractMonthStep {
  balanceCents: number;
  interestCents: number;
  principalCents: number;
  paymentCents: number;
  paidOff: boolean;
}

export interface CappedSpecialRepayment {
  appliedCents: number;
  capOverflowCents: number;
  exceedsDebtCents: number;
}

export const STALE_CALIBRATION_MONTHS = 12;

export interface ContractProjectionResult {
  contractId: string;
  asOfDate: string;
  monthsElapsed: number;
  isProjected: boolean;
  startingBalanceCents: number;
  projectedBalanceCents: number;
  totalInterestAccruedCents: number;
  totalPrincipalPaidCents: number;
  totalContributionsCents: number;
  reachedZeroAtMonth: number | null;
  targetProgressBps: number | null;
  isAllocationThresholdReached: boolean | null;
}

export interface ContractMilestone {
  contractId: string;
  contractName: string;
  category: ContractCategory;
  kind: "milestone" | "fixed_interest_end";
  date: string;
  label: string;
  daysRemaining: number;
  isOverdue: boolean;
}

const MONTHS_PER_YEAR_IN_BPS_DENOMINATOR = 120_000n;

/**
 * Calculates monthly interest in cents from an integer balance and basis-point rate
 * using pure BigInt half-up division: (balance * bps) / (12 * 10_000).
 */
export function calculateMonthlyInterestCents(
  balanceCents: number,
  interestRateBps: number,
): number {
  const safeBalance = assertNonNegativeInteger(balanceCents, "balanceCents");
  const safeBps = assertNonNegativeInteger(interestRateBps, "interestRateBps");

  if (safeBalance === 0 || safeBps === 0) {
    return 0;
  }

  const interest = roundHalfUpBigInt(
    BigInt(safeBalance) * BigInt(safeBps),
    MONTHS_PER_YEAR_IN_BPS_DENOMINATOR,
  );
  return assertSafeInteger(Number(interest), "monthlyInterestCents");
}

export function validateContract(contract: DomainContract): void {
  // Bausparverträge dürfen negativ starten (Abschlussgebühr wird zuerst belastet);
  // Darlehen bleiben >= 0.
  if (contract.category === "savings_contract") {
    assertSafeInteger(contract.currentBalanceCents, "currentBalanceCents");
  } else {
    assertNonNegativeInteger(
      contract.currentBalanceCents,
      "currentBalanceCents",
    );
  }
  assertNonNegativeInteger(contract.monthlyRateCents, "monthlyRateCents");
  assertNonNegativeInteger(contract.interestRateBps, "interestRateBps");
  parseIsoDate(contract.balanceAsOfDate, "balanceAsOfDate");

  if (contract.targetSumCents != null) {
    assertNonNegativeInteger(contract.targetSumCents, "targetSumCents");
  }
  if (contract.specialRepaymentMaxYearlyCents != null) {
    assertNonNegativeInteger(
      contract.specialRepaymentMaxYearlyCents,
      "specialRepaymentMaxYearlyCents",
    );
  }
  if (contract.allocationThresholdPercent != null) {
    const threshold = assertNonNegativeInteger(
      contract.allocationThresholdPercent,
      "allocationThresholdPercent",
    );
    if (threshold > 100) {
      throw new RangeError(
        `allocationThresholdPercent must be between 0 and 100, received: ${threshold}`,
      );
    }
  }
  if (contract.category === "loan") {
    validateLoanOptions(getLoanOptions(contract), {
      category: contract.category,
      repaymentType: contract.repaymentType,
      currentBalanceCents: contract.currentBalanceCents,
      interestRateBps: contract.interestRateBps,
    });
  }
}

/**
 * Advances a single contract by one month from `balanceCents`.
 */
export function stepContractMonth(
  input: ContractStepInput,
  balanceCents: number,
): ContractMonthStep {
  const safeRate = assertNonNegativeInteger(
    input.monthlyRateCents,
    "monthlyRateCents",
  );
  const safeBps = assertNonNegativeInteger(
    input.interestRateBps,
    "interestRateBps",
  );

  if (input.category === "savings_contract") {
    // Negativer Saldo (Abschlussgebühr) wird durch die Sparrate zuerst
    // ausgeglichen; Guthabenzins nur auf den positiven Teil des Saldos.
    const safeSavingsBalance = assertSafeInteger(balanceCents, "balanceCents");
    const interestCents = calculateMonthlyInterestCents(
      Math.max(0, safeSavingsBalance),
      safeBps,
    );
    const nextBalance = assertSafeInteger(
      safeSavingsBalance + safeRate + interestCents,
      "projectedBalanceCents",
    );
    return {
      balanceCents: nextBalance,
      interestCents,
      principalCents: 0,
      paymentCents: safeRate,
      paidOff: false,
    };
  }

  // category === "loan"
  const safeBalance = assertNonNegativeInteger(balanceCents, "balanceCents");
  if (safeBalance === 0) {
    return {
      balanceCents: 0,
      interestCents: 0,
      principalCents: 0,
      paymentCents: 0,
      paidOff: false,
    };
  }

  const interestCents = calculateMonthlyInterestCents(safeBalance, safeBps);

  if (input.repaymentType === "installment") {
    const principalCents = Math.min(safeBalance, safeRate);
    const nextBalance = safeBalance - principalCents;
    return {
      balanceCents: nextBalance,
      interestCents,
      principalCents,
      paymentCents: principalCents + interestCents,
      paidOff: nextBalance === 0,
    };
  }

  if (input.repaymentType === "lump_sum") {
    return {
      balanceCents: safeBalance,
      interestCents,
      principalCents: 0,
      paymentCents: interestCents,
      paidOff: false,
    };
  }

  // Default to annuity when repaymentType is "annuity" or unset
  const rawNext = safeBalance + interestCents - safeRate;
  if (rawNext <= 0) {
    return {
      balanceCents: 0,
      interestCents,
      principalCents: safeBalance,
      paymentCents: safeBalance + interestCents,
      paidOff: true,
    };
  }

  return {
    balanceCents: assertSafeInteger(rawNext, "balanceCents"),
    interestCents,
    principalCents: safeRate - interestCents,
    paymentCents: safeRate,
    paidOff: false,
  };
}

/**
 * Applies a special repayment capped by remaining debt and remaining yearly cap.
 */
export function applyCappedSpecialRepayment(
  debtCents: number,
  amountCents: number,
  capRemainingCents: number,
): CappedSpecialRepayment {
  const safeDebt = assertNonNegativeInteger(debtCents, "debtCents");
  const safeAmount = assertNonNegativeInteger(amountCents, "amountCents");
  const safeCap = assertSafeInteger(capRemainingCents, "capRemainingCents");

  const wanted = Math.min(safeAmount, safeDebt);
  const appliedCents = Math.min(wanted, Math.max(0, safeCap));
  return {
    appliedCents,
    capOverflowCents: wanted - appliedCents,
    exceedsDebtCents: safeAmount - wanted,
  };
}

/**
 * Computes calibration age in completed months and whether it exceeds STALE_CALIBRATION_MONTHS.
 */
export function getCalibrationAge(
  contract: Pick<DomainContract, "balanceAsOfDate">,
  asOfDate: string,
): { months: number; isStale: boolean } {
  parseIsoDate(contract.balanceAsOfDate, "balanceAsOfDate");
  parseIsoDate(asOfDate, "asOfDate");
  const months = countCompletedMonths(contract.balanceAsOfDate, asOfDate);
  return {
    months,
    isStale: months > STALE_CALIBRATION_MONTHS,
  };
}

/**
 * Projects a contract balance from its calibrated balanceAsOfDate up to asOfDate.
 */
export function projectContractBalance(
  contract: DomainContract,
  asOfDate: string,
): ContractProjectionResult {
  validateContract(contract);
  parseIsoDate(asOfDate, "asOfDate");

  const startingBalanceCents = contract.currentBalanceCents;
  const monthsElapsed = countCompletedMonths(
    contract.balanceAsOfDate,
    asOfDate,
  );

  let balance = startingBalanceCents;
  let totalInterestAccruedCents = 0;
  let totalPrincipalPaidCents = 0;
  let totalContributionsCents = 0;
  let reachedZeroAtMonth: number | null = null;

  const isLumpSumLoan =
    contract.category === "loan" && contract.repaymentType === "lump_sum";
  const shouldProject =
    contract.status === "active" && monthsElapsed > 0 && !isLumpSumLoan;

  if (shouldProject) {
    for (let month = 1; month <= monthsElapsed; month += 1) {
      if (contract.category === "loan" && balance === 0) {
        break;
      }

      const step = stepContractMonth(contract, balance);
      balance = step.balanceCents;
      totalInterestAccruedCents += step.interestCents;
      if (contract.category === "loan") {
        totalPrincipalPaidCents += step.principalCents;
      }
      totalContributionsCents += step.paymentCents;

      if (step.paidOff) {
        reachedZeroAtMonth = month;
        break;
      }
    }
  }

  let targetProgressBps: number | null = null;
  let isAllocationThresholdReached: boolean | null = null;

  if (contract.targetSumCents != null && contract.targetSumCents > 0) {
    // Negativer Saldo (Abschlussgebühr) zählt als 0 % Fortschritt.
    const progress =
      (BigInt(Math.max(0, balance)) * 10_000n) /
      BigInt(contract.targetSumCents);
    targetProgressBps = assertSafeInteger(
      Number(progress),
      "targetProgressBps",
    );

    if (contract.allocationThresholdPercent != null) {
      isAllocationThresholdReached =
        BigInt(balance) * 100n >=
        BigInt(contract.targetSumCents) *
          BigInt(contract.allocationThresholdPercent);
    }
  }

  return {
    contractId: contract.id,
    asOfDate,
    monthsElapsed,
    isProjected: shouldProject,
    startingBalanceCents,
    projectedBalanceCents: balance,
    totalInterestAccruedCents,
    totalPrincipalPaidCents,
    totalContributionsCents,
    reachedZeroAtMonth,
    targetProgressBps,
    isAllocationThresholdReached,
  };
}

function compareStrings(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/**
 * Extracts explicit contract milestones and fixed-interest end dates for non-closed contracts,
 * sorted deterministically by date, contractId, and kind.
 */
export function extractContractMilestones(
  contracts: readonly DomainContract[],
  referenceDate: string,
): ContractMilestone[] {
  parseIsoDate(referenceDate, "referenceDate");

  const milestones: ContractMilestone[] = [];

  for (const contract of contracts) {
    if (contract.status === "closed") {
      continue;
    }

    if (contract.milestoneDate != null) {
      parseIsoDate(contract.milestoneDate, "milestoneDate");
      const daysRemaining = diffCalendarDays(
        referenceDate,
        contract.milestoneDate,
      );
      const trimmedLabel = contract.milestoneLabel?.trim() ?? "";
      milestones.push({
        contractId: contract.id,
        contractName: contract.name,
        category: contract.category,
        kind: "milestone",
        date: contract.milestoneDate,
        label: trimmedLabel.length > 0 ? trimmedLabel : contract.name,
        daysRemaining,
        isOverdue: daysRemaining < 0,
      });
    }

    if (contract.fixedInterestUntil != null) {
      parseIsoDate(contract.fixedInterestUntil, "fixedInterestUntil");
      if (contract.fixedInterestUntil !== contract.milestoneDate) {
        const daysRemaining = diffCalendarDays(
          referenceDate,
          contract.fixedInterestUntil,
        );
        milestones.push({
          contractId: contract.id,
          contractName: contract.name,
            category: contract.category,
          kind: "fixed_interest_end",
          date: contract.fixedInterestUntil,
          label: "Zinsbindungsende",
          daysRemaining,
          isOverdue: daysRemaining < 0,
        });
      }
    }
  }

  milestones.sort(
    (a, b) =>
      compareStrings(a.date, b.date) ||
      compareStrings(a.contractId, b.contractId) ||
      compareStrings(a.kind, b.kind),
  );

  return milestones;
}
