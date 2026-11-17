import { assertNonNegativeInteger, assertSafeInteger } from "./money";

export type PotRuleType =
  | "fill_to_target"
  | "fixed_monthly"
  | "percentage_of_remainder";

export type WaterfallMode = "monthly" | "one_time";

export interface DomainPot {
  id: string;
  name: string;
  priority: number;
  currentCents: number;
  targetCents: number | null;
  ruleType: PotRuleType;
  fixedMonthlyCents?: number | null;
  remainderPercentage?: number | null;
}

export interface PotAllocationSuggestion {
  potId: string;
  potName: string;
  priority: number;
  ruleType: PotRuleType;
  currentCents: number;
  targetCents: number | null;
  allocatedCents: number;
  projectedCents: number;
  cappedByTarget: boolean;
}

export interface WaterfallPlan {
  mode: WaterfallMode;
  inputAmountCents: number;
  totalAllocatedCents: number;
  unallocatedCents: number;
  suggestions: PotAllocationSuggestion[];
}

function comparePots(a: DomainPot, b: DomainPot): number {
  if (a.priority !== b.priority) {
    return a.priority - b.priority;
  }
  if (a.id < b.id) return -1;
  if (a.id > b.id) return 1;
  return 0;
}

/**
 * Returns remaining headroom until targetCents is reached, or null if pot has no target.
 */
export function calculatePotHeadroomCents(pot: DomainPot): number | null {
  const current = assertNonNegativeInteger(pot.currentCents, "currentCents");
  if (pot.targetCents === null) {
    return null;
  }
  const target = assertNonNegativeInteger(pot.targetCents, "targetCents");
  return Math.max(0, target - current);
}

function validatePots(pots: readonly DomainPot[]): void {
  const seenIds = new Set<string>();
  let totalRemainderPct = 0;

  for (const pot of pots) {
    if (seenIds.has(pot.id)) {
      throw new RangeError(`Duplicate pot id: "${pot.id}"`);
    }
    seenIds.add(pot.id);

    assertSafeInteger(pot.priority, `pot(${pot.id}).priority`);
    calculatePotHeadroomCents(pot);

    if (pot.ruleType === "fill_to_target") {
      if (pot.targetCents === null) {
        throw new RangeError(
          `Pot "${pot.id}" with ruleType "fill_to_target" requires targetCents`,
        );
      }
    } else if (pot.ruleType === "fixed_monthly") {
      if (pot.fixedMonthlyCents == null) {
        throw new RangeError(
          `Pot "${pot.id}" with ruleType "fixed_monthly" requires fixedMonthlyCents`,
        );
      }
      assertNonNegativeInteger(
        pot.fixedMonthlyCents,
        `pot(${pot.id}).fixedMonthlyCents`,
      );
    } else if (pot.ruleType === "percentage_of_remainder") {
      if (pot.remainderPercentage == null) {
        throw new RangeError(
          `Pot "${pot.id}" with ruleType "percentage_of_remainder" requires remainderPercentage`,
        );
      }
      const pct = assertNonNegativeInteger(
        pot.remainderPercentage,
        `pot(${pot.id}).remainderPercentage`,
      );
      if (pct > 100) {
        throw new RangeError(
          `Pot "${pot.id}" remainderPercentage must be <= 100, received: ${pct}`,
        );
      }
      totalRemainderPct += pct;
    }
  }

  if (totalRemainderPct > 100) {
    throw new RangeError(
      `Sum of remainderPercentage across pots must be <= 100, received: ${totalRemainderPct}`,
    );
  }
}

/**
 * Calculates a prioritized 2-phase waterfall allocation suggestion without overpaying targets.
 */
export function calculateWaterfallSuggestion(
  pots: readonly DomainPot[],
  distributableCents: number,
  options?: { mode?: WaterfallMode },
): WaterfallPlan {
  const safeDistributable = assertNonNegativeInteger(
    distributableCents,
    "distributableCents",
  );
  const mode: WaterfallMode = options?.mode ?? "monthly";
  validatePots(pots);

  const sortedPots = [...pots].sort(comparePots);
  const allocations = new Map<string, number>();
  const cappedFlags = new Map<string, boolean>();

  for (const pot of sortedPots) {
    allocations.set(pot.id, 0);
    cappedFlags.set(pot.id, false);
  }

  let remaining = safeDistributable;

  if (safeDistributable > 0) {
    // Phase 1: fill_to_target and fixed_monthly in priority order
    for (const pot of sortedPots) {
      if (pot.ruleType === "percentage_of_remainder") {
        continue;
      }

      const headroom = calculatePotHeadroomCents(pot);
      let desired = 0;

      if (pot.ruleType === "fill_to_target") {
        desired = headroom ?? 0;
      } else if (pot.ruleType === "fixed_monthly") {
        desired = mode === "one_time" ? 0 : (pot.fixedMonthlyCents ?? 0);
      }

      const maxAllowed =
        headroom === null ? desired : Math.min(desired, headroom);
      const alloc = Math.min(remaining, maxAllowed);

      allocations.set(pot.id, alloc);
      cappedFlags.set(
        pot.id,
        headroom !== null &&
          (pot.ruleType === "fill_to_target" || desired > headroom) &&
          pot.currentCents + alloc >= (pot.targetCents ?? 0),
      );
      remaining -= alloc;
    }

    // Phase 2: percentage_of_remainder using Hamilton (Largest Remainder) method
    const percentagePots = sortedPots.filter(
      (pot) => pot.ruleType === "percentage_of_remainder",
    );
    const totalPct = percentagePots.reduce(
      (sum, pot) => sum + (pot.remainderPercentage ?? 0),
      0,
    );

    const phase2Pool = remaining;
    if (phase2Pool > 0 && percentagePots.length > 0 && totalPct > 0) {
      const shares = percentagePots.map((pot) => {
        const pct = pot.remainderPercentage ?? 0;
        const rawNumerator = BigInt(phase2Pool) * BigInt(pct);
        return {
          pot,
          floorShare: Number(rawNumerator / 100n),
          remainderFrac: Number(rawNumerator % 100n),
        };
      });

      const targetPool = Number(
        (BigInt(phase2Pool) * BigInt(totalPct)) / 100n,
      );
      const floorSum = shares.reduce((sum, s) => sum + s.floorShare, 0);
      const extraCents = targetPool - floorSum;

      // Distribute remainder cents by largest remainder, tie-breaking by (priority asc, id asc)
      const rankedIndices = shares
        .map((_, idx) => idx)
        .sort((idxA, idxB) => {
          const fracDiff =
            shares[idxB]!.remainderFrac - shares[idxA]!.remainderFrac;
          if (fracDiff !== 0) {
            return fracDiff;
          }
          return comparePots(shares[idxA]!.pot, shares[idxB]!.pot);
        });

      for (let i = 0; i < extraCents; i += 1) {
        const targetIdx = rankedIndices[i];
        if (targetIdx !== undefined) {
          shares[targetIdx]!.floorShare += 1;
        }
      }

      for (const { pot, floorShare } of shares) {
        const headroom = calculatePotHeadroomCents(pot);
        const capped = headroom !== null && floorShare > headroom;
        const alloc = headroom === null ? floorShare : Math.min(floorShare, headroom);

        allocations.set(pot.id, alloc);
        cappedFlags.set(pot.id, capped);
        remaining -= alloc;
      }
    }
  }

  let totalAllocatedCents = 0;
  const suggestions: PotAllocationSuggestion[] = sortedPots.map((pot) => {
    const allocatedCents = allocations.get(pot.id) ?? 0;
    totalAllocatedCents += allocatedCents;

    return {
      potId: pot.id,
      potName: pot.name,
      priority: pot.priority,
      ruleType: pot.ruleType,
      currentCents: pot.currentCents,
      targetCents: pot.targetCents,
      allocatedCents,
      projectedCents: pot.currentCents + allocatedCents,
      cappedByTarget: cappedFlags.get(pot.id) ?? false,
    };
  });

  return {
    mode,
    inputAmountCents: safeDistributable,
    totalAllocatedCents,
    unallocatedCents: remaining,
    suggestions,
  };
}

export interface ManualPotAllocationEntry {
  potId: string;
  allocatedCents: number;
}

export interface OverTargetWarning {
  potId: string;
  potName: string;
  excessCents: number;
}

export interface ManualWaterfallValidationResult {
  inputAmountCents: number;
  totalAllocatedCents: number;
  unallocatedCents: number;
  exceedsInput: boolean;
  hasPositiveAllocation: boolean;
  overTargetWarnings: OverTargetWarning[];
  projectedByPotId: Record<string, number>;
}

/**
 * Validates manually adjusted waterfall pot allocations against available input and pot targets.
 */
export function validateManualWaterfallAllocation(
  pots: readonly DomainPot[],
  inputAmountCents: number,
  entries: readonly ManualPotAllocationEntry[],
): ManualWaterfallValidationResult {
  const safeInput = assertNonNegativeInteger(
    inputAmountCents,
    "inputAmountCents",
  );
  validatePots(pots);

  const potById = new Map<string, DomainPot>();
  for (const pot of pots) {
    potById.set(pot.id, pot);
  }

  const allocatedByPotId = new Map<string, number>();
  let totalAllocatedCents = 0;

  for (const entry of entries) {
    if (allocatedByPotId.has(entry.potId)) {
      throw new RangeError(`Duplicate potId in allocations: "${entry.potId}"`);
    }
    if (!potById.has(entry.potId)) {
      throw new RangeError(`Unknown potId in allocations: "${entry.potId}"`);
    }
    const safeAlloc = assertNonNegativeInteger(
      entry.allocatedCents,
      `allocations(${entry.potId}).allocatedCents`,
    );
    allocatedByPotId.set(entry.potId, safeAlloc);
    totalAllocatedCents = assertSafeInteger(
      totalAllocatedCents + safeAlloc,
      "totalAllocatedCents",
    );
  }

  const sortedPots = [...pots].sort(comparePots);
  const overTargetWarnings: OverTargetWarning[] = [];
  const projectedByPotId: Record<string, number> = {};

  for (const pot of sortedPots) {
    const allocated = allocatedByPotId.get(pot.id) ?? 0;
    const projected = assertSafeInteger(
      pot.currentCents + allocated,
      `projected(${pot.id})`,
    );
    projectedByPotId[pot.id] = projected;

    if (pot.targetCents !== null && projected > pot.targetCents) {
      overTargetWarnings.push({
        potId: pot.id,
        potName: pot.name,
        excessCents: projected - pot.targetCents,
      });
    }
  }

  return {
    inputAmountCents: safeInput,
    totalAllocatedCents,
    unallocatedCents: safeInput - totalAllocatedCents,
    exceedsInput: totalAllocatedCents > safeInput,
    hasPositiveAllocation: totalAllocatedCents > 0,
    overTargetWarnings,
    projectedByPotId,
  };
}
