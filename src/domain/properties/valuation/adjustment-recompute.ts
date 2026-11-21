import { applyValuationAdjustment } from "./adjustments";
import type { ValuationChoice } from "./adoption";
import type { ValuationSourceKind } from "./write-decision";

export interface AppliedValuationEntryForRecompute {
  lowerCents: number;
  medianCents: number;
  upperCents: number;
  appliedChoice: ValuationChoice | null;
}

export interface PlanAdjustmentRecomputeInput {
  currentSource: ValuationSourceKind;
  currentValueCents: number;
  appliedEntry: AppliedValuationEntryForRecompute | null;
  newTotalBps: number;
}

export type PlanAdjustmentRecomputeResult =
  | {
      action: "none";
      reason: "manual_source" | "no_applied_entry" | "unchanged";
    }
  | {
      action: "recompute";
      fromCents: number;
      toCents: number;
      choice: ValuationChoice;
    };

function pickBaseCents(
  entry: AppliedValuationEntryForRecompute,
  choice: ValuationChoice,
): number {
  switch (choice) {
    case "lower":
      return entry.lowerCents;
    case "median":
      return entry.medianCents;
    case "upper":
      return entry.upperCents;
  }
}

export function planAdjustmentRecompute(
  input: PlanAdjustmentRecomputeInput,
): PlanAdjustmentRecomputeResult {
  if (input.currentSource !== "immoanalyse") {
    return { action: "none", reason: "manual_source" };
  }
  if (input.appliedEntry === null) {
    return { action: "none", reason: "no_applied_entry" };
  }

  const choice: ValuationChoice = input.appliedEntry.appliedChoice ?? "median";
  const baseCents = pickBaseCents(input.appliedEntry, choice);
  const toCents = applyValuationAdjustment(baseCents, input.newTotalBps);

  if (toCents === input.currentValueCents) {
    return { action: "none", reason: "unchanged" };
  }

  return {
    action: "recompute",
    fromCents: input.currentValueCents,
    toCents,
    choice,
  };
}
