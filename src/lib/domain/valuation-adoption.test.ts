import { describe, expect, it } from "vitest";
import {
  buildAdoptionRequest,
  getSelectedValuationCents,
  INITIAL_VALUATION_ADOPTION_STATE,
  valuationAdoptionReducer,
} from "./valuation-adoption";

const H1 = "11111111-1111-4111-8111-111111111111";
const H2 = "22222222-2222-4222-8222-222222222222";

describe("valuation-adoption", () => {
  it("transitions from suggested to confirming and only produces request on confirm", () => {
    const suggested = valuationAdoptionReducer(
      INITIAL_VALUATION_ADOPTION_STATE,
      { type: "suggest", historyId: H1 },
    );
    expect(suggested).toEqual({
      phase: "suggested",
      historyId: H1,
      choice: "median",
    });
    expect(buildAdoptionRequest(suggested, { type: "requestAdopt" })).toBeNull();

    const confirming = valuationAdoptionReducer(suggested, {
      type: "requestAdopt",
    });
    expect(confirming).toEqual({
      phase: "confirming",
      historyId: H1,
      choice: "median",
    });

    expect(buildAdoptionRequest(confirming, { type: "confirm" })).toEqual({
      historyId: H1,
      choice: "median",
    });

    const submitting = valuationAdoptionReducer(confirming, {
      type: "confirm",
    });
    expect(submitting).toEqual({
      phase: "submitting",
      historyId: H1,
      choice: "median",
    });
    expect(buildAdoptionRequest(submitting, { type: "confirm" })).toBeNull();
  });

  it("returns null request in idle, suggested, submitting, and after cancel", () => {
    const idle = INITIAL_VALUATION_ADOPTION_STATE;
    expect(buildAdoptionRequest(idle, { type: "confirm" })).toBeNull();

    const suggested = valuationAdoptionReducer(idle, {
      type: "suggest",
      historyId: H1,
    });
    expect(buildAdoptionRequest(suggested, { type: "confirm" })).toBeNull();

    const confirming = valuationAdoptionReducer(suggested, {
      type: "requestAdopt",
    });
    const cancelled = valuationAdoptionReducer(confirming, { type: "cancel" });
    expect(cancelled).toEqual({
      phase: "suggested",
      historyId: H1,
      choice: "median",
    });
    expect(buildAdoptionRequest(cancelled, { type: "confirm" })).toBeNull();
  });

  it("uses chosen upper bound in request when choose('upper') is followed by confirm", () => {
    let state = valuationAdoptionReducer(INITIAL_VALUATION_ADOPTION_STATE, {
      type: "suggest",
      historyId: H1,
    });
    state = valuationAdoptionReducer(state, { type: "choose", choice: "upper" });
    state = valuationAdoptionReducer(state, { type: "requestAdopt" });

    expect(buildAdoptionRequest(state, { type: "confirm" })).toEqual({
      historyId: H1,
      choice: "upper",
    });
    expect(
      getSelectedValuationCents(
        {
          lowerCents: 28_000_000,
          medianCents: 32_000_000,
          upperCents: 36_000_000,
        },
        "upper",
      ),
    ).toBe(36_000_000);
  });

  it("resets to suggested/median on new suggest during confirming", () => {
    let state = valuationAdoptionReducer(INITIAL_VALUATION_ADOPTION_STATE, {
      type: "suggest",
      historyId: H1,
    });
    state = valuationAdoptionReducer(state, { type: "choose", choice: "lower" });
    state = valuationAdoptionReducer(state, { type: "requestAdopt" });

    const next = valuationAdoptionReducer(state, {
      type: "suggest",
      historyId: H2,
    });
    expect(next).toEqual({
      phase: "suggested",
      historyId: H2,
      choice: "median",
    });
    expect(buildAdoptionRequest(next, { type: "confirm" })).toBeNull();
  });

  it("returns to confirming on failed and idle on done", () => {
    let state = valuationAdoptionReducer(INITIAL_VALUATION_ADOPTION_STATE, {
      type: "suggest",
      historyId: H1,
    });
    state = valuationAdoptionReducer(state, { type: "requestAdopt" });
    state = valuationAdoptionReducer(state, { type: "confirm" });
    state = valuationAdoptionReducer(state, { type: "failed" });
    expect(state).toEqual({
      phase: "confirming",
      historyId: H1,
      choice: "median",
    });

    state = valuationAdoptionReducer(state, { type: "confirm" });
    state = valuationAdoptionReducer(state, { type: "done" });
    expect(state).toEqual({ phase: "idle" });
  });
});
