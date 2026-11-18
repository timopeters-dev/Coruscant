import { describe, expect, it } from "vitest";
import type { PropertyValuation } from "./property-valuation";
import {
  buildAdoptionPatch,
  INITIAL_VALUATION_ADOPTION_STATE,
  valuationAdoptionReducer,
} from "./valuation-adoption";

const sampleValuation: PropertyValuation = {
  lowerCents: 28_000_000,
  medianCents: 32_000_000,
  upperCents: 36_000_000,
  pricePerSqmMedianCents: 320_000,
  asOfDate: "2026-10-15",
  rationale: "Marktbericht Musterstadt",
  factors: [],
  confidence: "medium",
  sources: [{ uri: "https://example.com", title: "Quelle" }],
  searchQueries: [],
};

describe("valuation-adoption", () => {
  it("transitions from suggested to confirming via requestAdopt and only produces patch on confirm", () => {
    const suggested = valuationAdoptionReducer(
      INITIAL_VALUATION_ADOPTION_STATE,
      { type: "suggest" },
    );
    expect(suggested).toEqual({ phase: "suggested", choice: "median" });
    expect(
      buildAdoptionPatch(
        suggested,
        { type: "requestAdopt" },
        sampleValuation,
        "2026-11-18",
      ),
    ).toBeNull();

    const confirming = valuationAdoptionReducer(suggested, {
      type: "requestAdopt",
    });
    expect(confirming).toEqual({ phase: "confirming", choice: "median" });

    const patch = buildAdoptionPatch(
      confirming,
      { type: "confirm" },
      sampleValuation,
      "2026-11-18",
    );
    expect(patch).toEqual({
      estimatedValueCents: 32_000_000,
      estimatedValueAsOf: "2026-11-18",
    });

    const submitting = valuationAdoptionReducer(confirming, {
      type: "confirm",
    });
    expect(submitting).toEqual({ phase: "submitting", choice: "median" });
    expect(
      buildAdoptionPatch(
        submitting,
        { type: "confirm" },
        sampleValuation,
        "2026-11-18",
      ),
    ).toBeNull();
  });

  it("returns null patch in idle, suggested, submitting, and after cancel", () => {
    const idle = INITIAL_VALUATION_ADOPTION_STATE;
    expect(
      buildAdoptionPatch(idle, { type: "confirm" }, sampleValuation, "2026-11-18"),
    ).toBeNull();

    const suggested = valuationAdoptionReducer(idle, { type: "suggest" });
    expect(
      buildAdoptionPatch(
        suggested,
        { type: "confirm" },
        sampleValuation,
        "2026-11-18",
      ),
    ).toBeNull();

    const confirming = valuationAdoptionReducer(suggested, {
      type: "requestAdopt",
    });
    const cancelled = valuationAdoptionReducer(confirming, { type: "cancel" });
    expect(cancelled).toEqual({ phase: "suggested", choice: "median" });
    expect(
      buildAdoptionPatch(
        cancelled,
        { type: "confirm" },
        sampleValuation,
        "2026-11-18",
      ),
    ).toBeNull();
  });

  it("uses chosen upper bound in patch when choose('upper') is followed by confirm", () => {
    let state = valuationAdoptionReducer(INITIAL_VALUATION_ADOPTION_STATE, {
      type: "suggest",
    });
    state = valuationAdoptionReducer(state, { type: "choose", choice: "upper" });
    state = valuationAdoptionReducer(state, { type: "requestAdopt" });

    const patch = buildAdoptionPatch(
      state,
      { type: "confirm" },
      sampleValuation,
      "2026-11-18",
    );
    expect(patch).toEqual({
      estimatedValueCents: 36_000_000,
      estimatedValueAsOf: "2026-11-18",
    });
  });

  it("resets to suggested/median on new suggest during confirming without producing a patch", () => {
    let state = valuationAdoptionReducer(INITIAL_VALUATION_ADOPTION_STATE, {
      type: "suggest",
    });
    state = valuationAdoptionReducer(state, { type: "choose", choice: "lower" });
    state = valuationAdoptionReducer(state, { type: "requestAdopt" });

    expect(
      buildAdoptionPatch(state, { type: "suggest" }, sampleValuation, "2026-11-18"),
    ).toBeNull();

    state = valuationAdoptionReducer(state, { type: "suggest" });
    expect(state).toEqual({ phase: "suggested", choice: "median" });
  });

  it("uses passed today as estimatedValueAsOf instead of valuation.asOfDate", () => {
    let state = valuationAdoptionReducer(INITIAL_VALUATION_ADOPTION_STATE, {
      type: "suggest",
    });
    state = valuationAdoptionReducer(state, { type: "requestAdopt" });

    const patch = buildAdoptionPatch(
      state,
      { type: "confirm" },
      sampleValuation,
      "2026-11-18",
    );
    expect(patch?.estimatedValueAsOf).toBe("2026-11-18");
    expect(patch?.estimatedValueAsOf).not.toBe(sampleValuation.asOfDate);
  });

  it("resets to idle on reset action", () => {
    let state = valuationAdoptionReducer(INITIAL_VALUATION_ADOPTION_STATE, {
      type: "suggest",
    });
    state = valuationAdoptionReducer(state, { type: "requestAdopt" });
    expect(state.phase).toBe("confirming");

    state = valuationAdoptionReducer(state, { type: "reset" });
    expect(state).toEqual(INITIAL_VALUATION_ADOPTION_STATE);
  });
});
