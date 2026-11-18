import type { PropertyValuation } from "./property-valuation";

export type ValuationChoice = "lower" | "median" | "upper";

export type ValuationAdoptionState =
  | { phase: "idle" }
  | { phase: "suggested"; choice: ValuationChoice }
  | { phase: "confirming"; choice: ValuationChoice }
  | { phase: "submitting"; choice: ValuationChoice };

export type ValuationAdoptionAction =
  | { type: "suggest" }
  | { type: "choose"; choice: ValuationChoice }
  | { type: "requestAdopt" }
  | { type: "cancel" }
  | { type: "confirm" }
  | { type: "done" }
  | { type: "failed" }
  | { type: "reset" };

export interface ValuationAdoptionPatch {
  estimatedValueCents: number;
  estimatedValueAsOf: string;
}

export const INITIAL_VALUATION_ADOPTION_STATE: ValuationAdoptionState = {
  phase: "idle",
};

export function valuationAdoptionReducer(
  state: ValuationAdoptionState,
  action: ValuationAdoptionAction,
): ValuationAdoptionState {
  switch (action.type) {
    case "suggest":
      return { phase: "suggested", choice: "median" };
    case "choose":
      if (state.phase === "suggested" || state.phase === "confirming") {
        return { phase: state.phase, choice: action.choice };
      }
      return state;
    case "requestAdopt":
      if (state.phase === "suggested") {
        return { phase: "confirming", choice: state.choice };
      }
      return state;
    case "cancel":
      if (state.phase === "confirming") {
        return { phase: "suggested", choice: state.choice };
      }
      return state;
    case "confirm":
      if (state.phase === "confirming") {
        return { phase: "submitting", choice: state.choice };
      }
      return state;
    case "done":
      if (state.phase === "submitting") {
        return { phase: "idle" };
      }
      return state;
    case "failed":
      if (state.phase === "submitting") {
        return { phase: "confirming", choice: state.choice };
      }
      return state;
    case "reset":
      return INITIAL_VALUATION_ADOPTION_STATE;
  }
}

export function getSelectedValuationCents(
  valuation: PropertyValuation,
  choice: ValuationChoice,
): number {
  switch (choice) {
    case "lower":
      return valuation.lowerCents;
    case "median":
      return valuation.medianCents;
    case "upper":
      return valuation.upperCents;
  }
}

export function buildAdoptionPatch(
  state: ValuationAdoptionState,
  action: ValuationAdoptionAction,
  valuation: PropertyValuation,
  today: string,
): ValuationAdoptionPatch | null {
  if (state.phase !== "confirming" || action.type !== "confirm") {
    return null;
  }
  return {
    estimatedValueCents: getSelectedValuationCents(valuation, state.choice),
    estimatedValueAsOf: today,
  };
}
