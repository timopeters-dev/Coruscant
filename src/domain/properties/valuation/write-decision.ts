import type { ValuationWarning } from "./valuation";

export type ValuationTrigger = "auto" | "manual";
export type ValuationSourceKind = "manual" | "immoanalyse";

export type ValuationWriteDecision =
  | { action: "write" }
  | {
      action: "history_only";
      reason: "manual_trigger" | "manual_source" | "deviation";
    };

export interface DecideValuationWriteInput {
  trigger: ValuationTrigger;
  currentSource: ValuationSourceKind;
  currentValueCents: number;
  warnings: readonly ValuationWarning[];
}

export function decideValuationWrite(
  input: DecideValuationWriteInput,
): ValuationWriteDecision {
  if (input.trigger === "manual") {
    return { action: "history_only", reason: "manual_trigger" };
  }
  if (input.currentSource === "manual" && input.currentValueCents > 0) {
    return { action: "history_only", reason: "manual_source" };
  }
  if (input.warnings.some((w) => w.code === "deviates_from_current")) {
    return { action: "history_only", reason: "deviation" };
  }
  return { action: "write" };
}
