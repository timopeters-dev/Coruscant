import {
  countCompletedMonths,
  diffCalendarDays,
  parseIsoDate,
} from "./date";
import {
  assertNonNegativeInteger,
  assertSafeInteger,
  roundHalfUpBigInt,
} from "./money";

export type ContractSphere = "household" | "personal";
export type ContractCategory = "loan" | "savings_contract";
export type ContractStatus = "active" | "paused" | "closed";
export type RepaymentType = "annuity" | "installment" | "lump_sum";

export interface DomainContract {
  id: string;
  name: string;
  sphere: ContractSphere;
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
}

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
  sphere: ContractSphere;
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

function validateContract(contract: DomainContract): void {
  assertNonNegativeInteger(contract.currentBalanceCents, "currentBalanceCents");
  assertNonNegativeInteger(contract.monthlyRateCents, "monthlyRateCents");
  assertNonNegativeInteger(contract.interestRateBps, "interestRateBps");
  parseIsoDate(contract.balanceAsOfDate, "balanceAsOfDate");

  if (contract.targetSumCents != null) {
    assertNonNegativeInteger(contract.targetSumCents, "targetSumCents");
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
      if (contract.category === "loan") {
        if (balance === 0) {
          break;
        }

        const interest = calculateMonthlyInterestCents(
          balance,
          contract.interestRateBps,
        );

        if (contract.repaymentType === "installment") {
          const principal = Math.min(balance, contract.monthlyRateCents);
          balance -= principal;
          totalInterestAccruedCents += interest;
          totalPrincipalPaidCents += principal;
          totalContributionsCents += principal + interest;

          if (balance === 0) {
            reachedZeroAtMonth = month;
            break;
          }
        } else {
          // Default to annuity for loans when repaymentType is "annuity" or unset
          const rawNext = balance + interest - contract.monthlyRateCents;
          if (rawNext <= 0) {
            const principal = balance;
            totalInterestAccruedCents += interest;
            totalPrincipalPaidCents += principal;
            totalContributionsCents += principal + interest;
            balance = 0;
            reachedZeroAtMonth = month;
            break;
          }

          totalInterestAccruedCents += interest;
          totalPrincipalPaidCents += contract.monthlyRateCents - interest;
          totalContributionsCents += contract.monthlyRateCents;
          balance = rawNext;
        }
      } else {
        // savings_contract
        const interest = calculateMonthlyInterestCents(
          balance,
          contract.interestRateBps,
        );
        balance = assertSafeInteger(
          balance + contract.monthlyRateCents + interest,
          "projectedBalanceCents",
        );
        totalInterestAccruedCents += interest;
        totalContributionsCents += contract.monthlyRateCents;
      }
    }
  }

  let targetProgressBps: number | null = null;
  let isAllocationThresholdReached: boolean | null = null;

  if (contract.targetSumCents != null && contract.targetSumCents > 0) {
    const progress =
      (BigInt(balance) * 10_000n) / BigInt(contract.targetSumCents);
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
        sphere: contract.sphere,
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
          sphere: contract.sphere,
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
