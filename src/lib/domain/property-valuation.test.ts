import { describe, expect, it } from "vitest";
import {
  validatePropertyValuation,
  type ValidatePropertyValuationInput,
} from "./property-valuation";
import type { PropertyValuationContext } from "./property-valuation-context";

const baseContext: PropertyValuationContext = {
  schemaVersion: 1,
  asOfMonth: "2026-11",
  location: {
    country: "DE",
    postalCode: "12345",
    city: "Musterstadt",
  },
  object: {
    usage: "owner_occupied",
    livingAreaSqm: 100,
    plotAreaSqm: null,
    constructionYear: 1998,
    energyClass: "C",
    renovations: [],
  },
  rental: null,
};

function makeInput(
  overrides: Partial<ValidatePropertyValuationInput> = {},
): ValidatePropertyValuationInput {
  return {
    rawOutput: {
      lowerEur: 280_000,
      medianEur: 320_000,
      upperEur: 360_000,
      asOfDate: "2026-11-01",
      rationale: "Solide Nachfrage in Musterstadt bei vergleichbaren Objekten.",
      factors: [{ label: "Gute Energieklasse", effect: "up" }],
      confidence: "medium",
    },
    sources: [{ uri: "https://example.com/markt", title: "Marktbericht" }],
    searchQueries: ["12345 Musterstadt Quadratmeterpreis"],
    context: baseContext,
    currentValueCents: 30_000_000,
    today: "2026-11-18",
    ...overrides,
  };
}

describe("property-valuation", () => {
  it("converts EUR to cents, computes €/sqm, and returns no warnings on happy path", () => {
    const result = validatePropertyValuation(makeInput());
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.valuation.lowerCents).toBe(28_000_000);
    expect(result.valuation.medianCents).toBe(32_000_000);
    expect(result.valuation.upperCents).toBe(36_000_000);
    expect(result.valuation.pricePerSqmMedianCents).toBe(320_000);
    expect(result.warnings).toEqual([]);
  });

  it("rejects reversed or inconsistent bounds with bounds_order", () => {
    const base = makeInput();
    expect(
      validatePropertyValuation({
        ...base,
        rawOutput: { ...base.rawOutput, lowerEur: 400_000, upperEur: 300_000 },
      }),
    ).toEqual({ ok: false, reason: "bounds_order" });

    expect(
      validatePropertyValuation({
        ...base,
        rawOutput: { ...base.rawOutput, medianEur: 370_000 },
      }),
    ).toEqual({ ok: false, reason: "bounds_order" });

    expect(
      validatePropertyValuation({
        ...base,
        rawOutput: { ...base.rawOutput, medianEur: 250_000 },
      }),
    ).toEqual({ ok: false, reason: "bounds_order" });
  });

  it("allows lower = median = upper", () => {
    const base = makeInput();
    const result = validatePropertyValuation({
      ...base,
      rawOutput: {
        ...base.rawOutput,
        lowerEur: 300_000,
        medianEur: 300_000,
        upperEur: 300_000,
      },
    });
    expect(result.ok).toBe(true);
  });

  it("rejects zero or negative values in any bound with non_positive", () => {
    const base = makeInput();
    for (const patch of [
      { lowerEur: 0 },
      { medianEur: 0 },
      { upperEur: 0 },
      { lowerEur: -100 },
      { medianEur: -100 },
      { upperEur: -100 },
    ]) {
      expect(
        validatePropertyValuation({
          ...base,
          rawOutput: { ...base.rawOutput, ...patch },
        }),
      ).toEqual({ ok: false, reason: "non_positive" });
    }
  });

  it("enforces €/sqm boundaries and catches 100x cent-as-euro errors", () => {
    const base = makeInput({
      context: {
        ...baseContext,
        object: { ...baseContext.object, livingAreaSqm: 100 },
      },
      currentValueCents: 0,
    });

    // 29_999 € / 100 sqm -> 299,99 €/sqm (29_999 cents) -> rejected
    expect(
      validatePropertyValuation({
        ...base,
        rawOutput: {
          ...base.rawOutput,
          lowerEur: 29_999,
          medianEur: 29_999,
          upperEur: 29_999,
        },
      }),
    ).toEqual({ ok: false, reason: "price_per_sqm_out_of_range" });

    // Exactly 300 €/sqm -> valid
    expect(
      validatePropertyValuation({
        ...base,
        rawOutput: {
          ...base.rawOutput,
          lowerEur: 30_000,
          medianEur: 30_000,
          upperEur: 30_000,
        },
      }).ok,
    ).toBe(true);

    // Exactly 30.000 €/sqm -> valid
    expect(
      validatePropertyValuation({
        ...base,
        rawOutput: {
          ...base.rawOutput,
          lowerEur: 3_000_000,
          medianEur: 3_000_000,
          upperEur: 3_000_000,
        },
      }).ok,
    ).toBe(true);

    // 3.000.001 € / 100 sqm -> 30.000,01 €/sqm -> rejected
    expect(
      validatePropertyValuation({
        ...base,
        rawOutput: {
          ...base.rawOutput,
          lowerEur: 3_000_001,
          medianEur: 3_000_001,
          upperEur: 3_000_001,
        },
      }),
    ).toEqual({ ok: false, reason: "price_per_sqm_out_of_range" });

    // 100x error (cents delivered as EUR: 30_000_000 € for 100 sqm = 300.000 €/sqm)
    expect(
      validatePropertyValuation({
        ...base,
        rawOutput: {
          ...base.rawOutput,
          lowerEur: 28_000_000,
          medianEur: 30_000_000,
          upperEur: 32_000_000,
        },
      }),
    ).toEqual({ ok: false, reason: "price_per_sqm_out_of_range" });
  });

  it("enforces spread ratio <= 2.0", () => {
    const base = makeInput({ currentValueCents: 0 });
    expect(
      validatePropertyValuation({
        ...base,
        rawOutput: {
          ...base.rawOutput,
          lowerEur: 200_000,
          medianEur: 300_000,
          upperEur: 400_000,
        },
      }).ok,
    ).toBe(true);

    expect(
      validatePropertyValuation({
        ...base,
        rawOutput: {
          ...base.rawOutput,
          lowerEur: 200_000,
          medianEur: 300_000,
          upperEur: 400_001,
        },
      }),
    ).toEqual({ ok: false, reason: "spread_too_wide" });
  });

  it("validates asOfDate against today and 24-month limit", () => {
    const base = makeInput();
    expect(
      validatePropertyValuation({
        ...base,
        rawOutput: { ...base.rawOutput, asOfDate: "2026-11-19" },
      }),
    ).toEqual({ ok: false, reason: "as_of_in_future" });

    expect(
      validatePropertyValuation({
        ...base,
        rawOutput: { ...base.rawOutput, asOfDate: "2026-11-18" },
      }).ok,
    ).toBe(true);

    expect(
      validatePropertyValuation({
        ...base,
        rawOutput: { ...base.rawOutput, asOfDate: "2024-11-18" },
      }).ok,
    ).toBe(true);

    expect(
      validatePropertyValuation({
        ...base,
        rawOutput: { ...base.rawOutput, asOfDate: "2024-11-17" },
      }),
    ).toEqual({ ok: false, reason: "as_of_too_old" });
  });

  it("rejects ungrounded responses first regardless of other errors", () => {
    const base = makeInput({ sources: [] });
    expect(
      validatePropertyValuation({
        ...base,
        rawOutput: { ...base.rawOutput, lowerEur: -1 },
      }),
    ).toEqual({ ok: false, reason: "ungrounded" });
  });

  it("emits deviates_from_current warning only when deviation exceeds ±40% and currentValueCents > 0", () => {
    // current = 100_000 € (10_000_000 cents)
    const base = makeInput({ currentValueCents: 10_000_000 });

    // +40% exact -> 140_000 € -> no warning
    const exactPlus40 = validatePropertyValuation({
      ...base,
      rawOutput: {
        ...base.rawOutput,
        lowerEur: 120_000,
        medianEur: 140_000,
        upperEur: 160_000,
      },
    });
    expect(exactPlus40.ok).toBe(true);
    if (exactPlus40.ok) {
      expect(exactPlus40.warnings).toEqual([]);
    }

    // +40% + 1 EUR -> 140_001 € -> warning triggered
    const overPlus40 = validatePropertyValuation({
      ...base,
      rawOutput: {
        ...base.rawOutput,
        lowerEur: 120_000,
        medianEur: 140_001,
        upperEur: 160_000,
      },
    });
    expect(overPlus40.ok).toBe(true);
    if (overPlus40.ok) {
      expect(overPlus40.warnings).toHaveLength(1);
      expect(overPlus40.warnings[0]?.code).toBe("deviates_from_current");
      expect(overPlus40.warnings[0]?.deviationBps).toBeGreaterThanOrEqual(4_000);
    }

    // +40.01% -> 140_010 € -> 4_001 bps
    const overPlus4001 = validatePropertyValuation({
      ...base,
      rawOutput: {
        ...base.rawOutput,
        lowerEur: 120_000,
        medianEur: 140_010,
        upperEur: 160_000,
      },
    });
    expect(overPlus4001.ok).toBe(true);
    if (overPlus4001.ok) {
      expect(overPlus4001.warnings).toEqual([
        { code: "deviates_from_current", deviationBps: 4_001 },
      ]);
    }

    // -45% -> 55_000 € -> warning with negative bps
    const minus45 = validatePropertyValuation({
      ...base,
      rawOutput: {
        ...base.rawOutput,
        lowerEur: 50_000,
        medianEur: 55_000,
        upperEur: 60_000,
      },
    });
    expect(minus45.ok).toBe(true);
    if (minus45.ok) {
      expect(minus45.warnings).toEqual([
        { code: "deviates_from_current", deviationBps: -4_500 },
      ]);
    }

    // currentValueCents = 0 -> never warns
    const zeroCurrent = validatePropertyValuation({
      ...base,
      currentValueCents: 0,
      rawOutput: {
        ...base.rawOutput,
        lowerEur: 200_000,
        medianEur: 250_000,
        upperEur: 300_000,
      },
    });
    expect(zeroCurrent.ok).toBe(true);
    if (zeroCurrent.ok) {
      expect(zeroCurrent.warnings).toEqual([]);
    }
  });

  it("rejects overflow near Number.MAX_SAFE_INTEGER cleanly without throwing", () => {
    const base = makeInput();
    expect(
      validatePropertyValuation({
        ...base,
        rawOutput: {
          ...base.rawOutput,
          lowerEur: Number.MAX_SAFE_INTEGER,
          medianEur: Number.MAX_SAFE_INTEGER,
          upperEur: Number.MAX_SAFE_INTEGER,
        },
      }),
    ).toEqual({ ok: false, reason: "non_positive" });
  });
});
