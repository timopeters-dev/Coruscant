import { describe, expect, it } from "vitest";
import {
  validatePropertyValuation,
  type NormalizedValuationResult,
  type ValidatePropertyValuationInput,
} from "./property-valuation";
import type { PropertyValuationContext } from "./property-valuation-context";

const baseContext: PropertyValuationContext = {
  schemaVersion: 2,
  asOfMonth: "2026-11",
  location: {
    country: "DE",
    postalCode: "12345",
    city: "Musterstadt",
  },
  object: {
    usage: "owner_occupied",
    propertyType: "etw",
    livingAreaSqm: 100,
    plotAreaSqm: null,
    constructionYear: 1998,
    energyClass: "C",
    renovations: [],
  },
  rental: null,
};

function makeNormalized(
  overrides: Partial<NormalizedValuationResult> = {},
): NormalizedValuationResult {
  return {
    requestId: "req_test_1",
    cached: false,
    valuability: "valuable",
    lowerCents: 28_000_000,
    medianCents: 32_000_000,
    upperCents: 36_000_000,
    asOfDate: "2026-11-01",
    confidence: "medium",
    confidenceScore: 76,
    rationale: "Solide Nachfrage in Musterstadt bei vergleichbaren Objekten.",
    limitations: [],
    factors: [{ label: "Gute Energieklasse", effect: "up" }],
    ...overrides,
  };
}

function makeInput(
  overrides: Partial<ValidatePropertyValuationInput> = {},
): ValidatePropertyValuationInput {
  return {
    normalized: makeNormalized(),
    context: baseContext,
    currentValueCents: 30_000_000,
    today: "2026-11-18",
    ...overrides,
  };
}

describe("property-valuation", () => {
  it("computes €/sqm and returns no warnings on happy path", () => {
    const result = validatePropertyValuation(makeInput());
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.valuation.lowerCents).toBe(28_000_000);
    expect(result.valuation.medianCents).toBe(32_000_000);
    expect(result.valuation.upperCents).toBe(36_000_000);
    expect(result.valuation.pricePerSqmMedianCents).toBe(320_000);
    expect(result.valuation.requestId).toBe("req_test_1");
    expect(result.warnings).toEqual([]);
  });

  it("rejects not_reliably_valuable first even when values look plausible", () => {
    const result = validatePropertyValuation(
      makeInput({
        normalized: makeNormalized({ valuability: "not_reliably_valuable" }),
      }),
    );
    expect(result).toEqual({ ok: false, reason: "not_reliably_valuable" });
  });

  it("rejects reversed or inconsistent bounds with bounds_order", () => {
    expect(
      validatePropertyValuation(
        makeInput({
          normalized: makeNormalized({
            lowerCents: 40_000_000,
            upperCents: 30_000_000,
          }),
        }),
      ),
    ).toEqual({ ok: false, reason: "bounds_order" });

    expect(
      validatePropertyValuation(
        makeInput({
          normalized: makeNormalized({ medianCents: 37_000_000 }),
        }),
      ),
    ).toEqual({ ok: false, reason: "bounds_order" });

    expect(
      validatePropertyValuation(
        makeInput({
          normalized: makeNormalized({ medianCents: 25_000_000 }),
        }),
      ),
    ).toEqual({ ok: false, reason: "bounds_order" });
  });

  it("allows lower = median = upper", () => {
    const result = validatePropertyValuation(
      makeInput({
        normalized: makeNormalized({
          lowerCents: 30_000_000,
          medianCents: 30_000_000,
          upperCents: 30_000_000,
        }),
      }),
    );
    expect(result.ok).toBe(true);
  });

  it("rejects null, zero, or negative values in any bound with non_positive", () => {
    for (const patch of [
      { lowerCents: null },
      { medianCents: null },
      { upperCents: null },
      { lowerCents: 0 },
      { medianCents: 0 },
      { upperCents: 0 },
      { lowerCents: -100 },
      { medianCents: -100 },
      { upperCents: -100 },
    ]) {
      expect(
        validatePropertyValuation(
          makeInput({
            normalized: makeNormalized(patch),
          }),
        ),
      ).toEqual({ ok: false, reason: "non_positive" });
    }
  });

  it("enforces €/sqm boundaries", () => {
    const base = makeInput({ currentValueCents: 0 });

    expect(
      validatePropertyValuation({
        ...base,
        normalized: makeNormalized({
          lowerCents: 2_999_900,
          medianCents: 2_999_900,
          upperCents: 2_999_900,
        }),
      }),
    ).toEqual({ ok: false, reason: "price_per_sqm_out_of_range" });

    expect(
      validatePropertyValuation({
        ...base,
        normalized: makeNormalized({
          lowerCents: 3_000_000,
          medianCents: 3_000_000,
          upperCents: 3_000_000,
        }),
      }).ok,
    ).toBe(true);

    expect(
      validatePropertyValuation({
        ...base,
        normalized: makeNormalized({
          lowerCents: 300_000_000,
          medianCents: 300_000_000,
          upperCents: 300_000_000,
        }),
      }).ok,
    ).toBe(true);

    expect(
      validatePropertyValuation({
        ...base,
        normalized: makeNormalized({
          lowerCents: 300_000_100,
          medianCents: 300_000_100,
          upperCents: 300_000_100,
        }),
      }),
    ).toEqual({ ok: false, reason: "price_per_sqm_out_of_range" });
  });

  it("enforces spread ratio <= 2.0", () => {
    const base = makeInput({ currentValueCents: 0 });
    expect(
      validatePropertyValuation({
        ...base,
        normalized: makeNormalized({
          lowerCents: 20_000_000,
          medianCents: 30_000_000,
          upperCents: 40_000_000,
        }),
      }).ok,
    ).toBe(true);

    expect(
      validatePropertyValuation({
        ...base,
        normalized: makeNormalized({
          lowerCents: 20_000_000,
          medianCents: 30_000_000,
          upperCents: 40_000_100,
        }),
      }),
    ).toEqual({ ok: false, reason: "spread_too_wide" });
  });

  it("validates asOfDate against today and 24-month limit", () => {
    expect(
      validatePropertyValuation(
        makeInput({
          normalized: makeNormalized({ asOfDate: "2026-11-19" }),
        }),
      ),
    ).toEqual({ ok: false, reason: "as_of_in_future" });

    expect(
      validatePropertyValuation(
        makeInput({
          normalized: makeNormalized({ asOfDate: "2026-11-18" }),
        }),
      ).ok,
    ).toBe(true);

    expect(
      validatePropertyValuation(
        makeInput({
          normalized: makeNormalized({ asOfDate: "2024-11-18" }),
        }),
      ).ok,
    ).toBe(true);

    expect(
      validatePropertyValuation(
        makeInput({
          normalized: makeNormalized({ asOfDate: "2024-11-17" }),
        }),
      ),
    ).toEqual({ ok: false, reason: "as_of_too_old" });
  });

  it("emits deviates_from_current warning only when deviation exceeds ±40% and currentValueCents > 0", () => {
    const base = makeInput({ currentValueCents: 10_000_000 });

    const exactPlus40 = validatePropertyValuation({
      ...base,
      normalized: makeNormalized({
        lowerCents: 12_000_000,
        medianCents: 14_000_000,
        upperCents: 16_000_000,
      }),
    });
    expect(exactPlus40.ok).toBe(true);
    if (exactPlus40.ok) {
      expect(exactPlus40.warnings).toEqual([]);
    }

    const overPlus40 = validatePropertyValuation({
      ...base,
      normalized: makeNormalized({
        lowerCents: 12_000_000,
        medianCents: 14_001_000,
        upperCents: 16_000_000,
      }),
    });
    expect(overPlus40.ok).toBe(true);
    if (overPlus40.ok) {
      expect(overPlus40.warnings).toEqual([
        { code: "deviates_from_current", deviationBps: 4_001 },
      ]);
    }

    const minus45 = validatePropertyValuation({
      ...base,
      normalized: makeNormalized({
        lowerCents: 5_000_000,
        medianCents: 5_500_000,
        upperCents: 6_000_000,
      }),
    });
    expect(minus45.ok).toBe(true);
    if (minus45.ok) {
      expect(minus45.warnings).toEqual([
        { code: "deviates_from_current", deviationBps: -4_500 },
      ]);
    }

    const zeroCurrent = validatePropertyValuation({
      ...base,
      currentValueCents: 0,
      normalized: makeNormalized({
        lowerCents: 20_000_000,
        medianCents: 25_000_000,
        upperCents: 30_000_000,
      }),
    });
    expect(zeroCurrent.ok).toBe(true);
    if (zeroCurrent.ok) {
      expect(zeroCurrent.warnings).toEqual([]);
    }
  });
});
