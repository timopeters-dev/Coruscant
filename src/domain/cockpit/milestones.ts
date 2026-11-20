import {
  type ContractMilestone,
  type DomainContract,
  extractContractMilestones,
} from "@/domain/contracts/contract";
import { parseIsoDate } from "@/domain/core/date";
import { assertNonNegativeInteger, roundHalfUpBigInt } from "@/domain/core/money";
import type { DomainPot } from "@/domain/allocation/waterfall";

export interface ActiveMilestonesResult {
  items: ContractMilestone[];
  totalCount: number;
  overdueCount: number;
}

export interface PotProgressItem {
  id: string;
  name: string;
  priority: number;
  currentCents: number;
  targetCents: number | null;
  progressBps: number | null;
  cappedProgressBps: number | null;
  remainingCents: number | null;
  isTargetReached: boolean;
}

/**
 * Selects upcoming (and overdue) milestones from strictly active contracts,
 * ordered chronologically and capped at `limit`.
 */
export function selectUpcomingActiveMilestones(
  contracts: readonly DomainContract[],
  referenceDate: string,
  limit = 5,
): ActiveMilestonesResult {
  parseIsoDate(referenceDate, "referenceDate");
  const safeLimit = assertNonNegativeInteger(limit, "limit");

  const activeContracts = contracts.filter(
    (contract) => contract.status === "active",
  );
  const allMilestones = extractContractMilestones(
    activeContracts,
    referenceDate,
  );
  const overdueCount = allMilestones.filter(
    (milestone) => milestone.daysRemaining < 0,
  ).length;

  return {
    items: allMilestones.slice(0, safeLimit),
    totalCount: allMilestones.length,
    overdueCount,
  };
}

function comparePotsByPriority(a: DomainPot, b: DomainPot): number {
  if (a.priority !== b.priority) {
    return a.priority - b.priority;
  }
  if (a.id < b.id) return -1;
  if (a.id > b.id) return 1;
  return 0;
}

/**
 * Projects the top N pots ordered by waterfall priority (`priority ASC, id ASC`)
 * with integer basis-point progress and remaining headroom.
 */
export function selectTopPotProgress(
  pots: readonly DomainPot[],
  limit = 3,
): PotProgressItem[] {
  const safeLimit = assertNonNegativeInteger(limit, "limit");

  const sorted = [...pots].sort(comparePotsByPriority).slice(0, safeLimit);

  return sorted.map((pot) => {
    const currentCents = assertNonNegativeInteger(
      pot.currentCents,
      `pot(${pot.id}).currentCents`,
    );
    const targetCents =
      pot.targetCents === null
        ? null
        : assertNonNegativeInteger(pot.targetCents, `pot(${pot.id}).targetCents`);

    let progressBps: number | null = null;
    if (targetCents !== null && targetCents > 0) {
      progressBps = Number(
        roundHalfUpBigInt(BigInt(currentCents) * 10_000n, BigInt(targetCents)),
      );
    }

    const cappedProgressBps =
      progressBps === null ? null : Math.min(10_000, progressBps);
    const remainingCents =
      targetCents === null ? null : Math.max(0, targetCents - currentCents);
    const isTargetReached =
      targetCents !== null && targetCents > 0 && currentCents >= targetCents;

    return {
      id: pot.id,
      name: pot.name,
      priority: pot.priority,
      currentCents,
      targetCents,
      progressBps,
      cappedProgressBps,
      remainingCents,
      isTargetReached,
    };
  });
}
