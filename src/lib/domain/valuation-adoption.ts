export type ValuationChoice = "lower" | "median" | "upper";

export type ValuationAdoptionState =
  | { phase: "idle" }
  | { phase: "suggested"; historyId: string; choice: ValuationChoice }
  | { phase: "confirming"; historyId: string; choice: ValuationChoice }
  | { phase: "submitting"; historyId: string; choice: ValuationChoice };

export type ValuationAdoptionAction =
  | { type: "suggest"; historyId: string }
  | { type: "choose"; choice: ValuationChoice }
  | { type: "requestAdopt" }
  | { type: "cancel" }
  | { type: "confirm" }
  | { type: "done" }
  | { type: "failed" }
  | { type: "reset" };

export interface ValuationAdoptionRequest {
  historyId: string;
  choice: ValuationChoice;
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
      return {
        phase: "suggested",
        historyId: action.historyId,
        choice: "median",
      };
    case "choose":
      if (state.phase === "suggested" || state.phase === "confirming") {
        return {
          phase: state.phase,
          historyId: state.historyId,
          choice: action.choice,
        };
      }
      return state;
    case "requestAdopt":
      if (state.phase === "suggested") {
        return {
          phase: "confirming",
          historyId: state.historyId,
          choice: state.choice,
        };
      }
      return state;
    case "cancel":
      if (state.phase === "confirming") {
        return {
          phase: "suggested",
          historyId: state.historyId,
          choice: state.choice,
        };
      }
      return state;
    case "confirm":
      if (state.phase === "confirming") {
        return {
          phase: "submitting",
          historyId: state.historyId,
          choice: state.choice,
        };
      }
      return state;
    case "done":
      if (state.phase === "submitting") {
        return { phase: "idle" };
      }
      return state;
    case "failed":
      if (state.phase === "submitting") {
        return {
          phase: "confirming",
          historyId: state.historyId,
          choice: state.choice,
        };
      }
      return state;
    case "reset":
      return INITIAL_VALUATION_ADOPTION_STATE;
  }
}

export function getSelectedValuationCents(
  bounds: { lowerCents: number; medianCents: number; upperCents: number },
  choice: ValuationChoice,
): number {
  switch (choice) {
    case "lower":
      return bounds.lowerCents;
    case "median":
      return bounds.medianCents;
    case "upper":
      return bounds.upperCents;
  }
}

export function buildAdoptionRequest(
  state: ValuationAdoptionState,
  action: ValuationAdoptionAction,
): ValuationAdoptionRequest | null {
  if (state.phase !== "confirming" || action.type !== "confirm") {
    return null;
  }
  return {
    historyId: state.historyId,
    choice: state.choice,
  };
}
