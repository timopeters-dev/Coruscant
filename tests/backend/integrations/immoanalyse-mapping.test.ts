import { describe, expect, it } from "vitest";
import {
  buildPropertyValuationContext,
  ValuationContextPiiError,
  type PropertyValuationContext,
} from "@/domain/properties/valuation/context";
import {
  assertRequestHasNoAddress,
  buildImmoAnalyseRequest,
  eurNumberToCents,
  normalizeDataAsOf,
  normalizeImmoAnalyseResult,
  normalizeQuota,
  serializeImmoAnalyseRequest,
} from "@/backend/integrations/immoanalyse-mapping";

function makeContext(
  overrides: Partial<PropertyValuationContext> = {},
): PropertyValuationContext {
  return {
    schemaVersion: 2,
    asOfMonth: "2026-11",
    location: {
      country: "DE",
      postalCode: "12345",
      city: "Musterstadt",
    },
    object: {
      usage: "rented",
      propertyType: "etw",
      livingAreaSqm: 85,
      plotAreaSqm: 240,
      constructionYear: 1998,
      energyClass: "C",
      renovations: [{ year: 2020, kind: "roof" }],
    },
    rental: {
      monthlyColdRentCents: 85_050,
      rentPerSqmCents: 1_001,
    },
    ...overrides,
  };
}

describe("immoanalyse-mapping", () => {
  it("builds exact serialized request body on happy path", () => {
    const body = buildImmoAnalyseRequest(makeContext());
    const json = serializeImmoAnalyseRequest(body);
    expect(json).toBe(
      `{
  "haustyp": "etw",
  "plz": "12345",
  "wohnflaeche": 85,
  "vermietet": true,
  "ort": "Musterstadt",
  "grundstuecksflaeche": 240,
  "baujahr": 1998,
  "energieklasse": "C",
  "kaltmiete": 850.5
}`,
    );
  });

  it("never includes adresse, lat, lon, kaufpreis, meta, street, name, or features", () => {
    const ctx = makeContext();
    const body = buildImmoAnalyseRequest(ctx);
    const keys = Object.keys(body);
    for (const forbidden of ["adresse", "lat", "lon", "kaufpreis", "meta", "name", "features"]) {
      expect(keys).not.toContain(forbidden);
    }
    const json = serializeImmoAnalyseRequest(body);
    expect(json).not.toContain("Musterstraße");
    expect(json).not.toContain("Musterstraße 1");
    expect(() => assertRequestHasNoAddress(body)).not.toThrow();
    expect(() =>
      assertRequestHasNoAddress({ ...body, adresse: "Musterstraße 1" }),
    ).toThrow(ValuationContextPiiError);
  });

  it("handles optional fields cleanly", () => {
    const ownerBody = buildImmoAnalyseRequest(
      makeContext({
        location: { country: "DE", postalCode: "12345", city: null },
        object: {
          usage: "owner_occupied",
          propertyType: "efh",
          livingAreaSqm: 140,
          plotAreaSqm: 0,
          constructionYear: 1499,
          energyClass: null,
          renovations: [],
        },
        rental: null,
      }),
    );

    expect(ownerBody).toEqual({
      haustyp: "efh",
      plz: "12345",
      wohnflaeche: 140,
      vermietet: false,
    });
    expect("kaltmiete" in ownerBody).toBe(false);
    expect("ort" in ownerBody).toBe(false);
    expect("baujahr" in ownerBody).toBe(false);
    expect("grundstuecksflaeche" in ownerBody).toBe(false);
  });

  it("converts euro numbers to integer cents safely", () => {
    expect(eurNumberToCents(312_345.5)).toBe(31_234_550);
    expect(eurNumberToCents(0.1 + 0.2)).toBe(30);
    expect(eurNumberToCents(-1)).toBeNull();
    expect(eurNumberToCents(Number.POSITIVE_INFINITY)).toBeNull();
    expect(eurNumberToCents(Number.MAX_SAFE_INTEGER)).toBeNull();
  });

  it("normalizes data_as_of formats and falls back cleanly", () => {
    expect(normalizeDataAsOf("2026-10-01", "2026-11-18")).toBe("2026-10-01");
    expect(normalizeDataAsOf("2026-10", "2026-11-18")).toBe("2026-10-01");
    expect(normalizeDataAsOf("2026-10-01T12:34:56Z", "2026-11-18")).toBe(
      "2026-10-01",
    );
    expect(normalizeDataAsOf(null, "2026-11-18")).toBe("2026-11-18");
    expect(normalizeDataAsOf("ungueltig", "2026-11-18")).toBe("2026-11-18");
  });

  it("normalizes confidence, factors (max 6), limitations, and quota", () => {
    const normalized = normalizeImmoAnalyseResult(
      {
        request_id: "req_1",
        cached: true,
        data_as_of: "2026-10",
        bewertbarkeit: {
          status: "valuable_with_limitations",
          begruendung: "Gute Lage",
          limitations: ["Punkt 1", 123, "Punkt 2"],
        },
        marktwert: {
          min: 280_000,
          median: 312_345.5,
          max: 350_000,
        },
        konfidenz: {
          wert: 82,
          level: "hoch",
        },
        kennzahlen: {
          merkmal_anpassung: {
            posten: [
              { label: "F1", prozent: 3 },
              { label: "F2", prozent: -2 },
              { label: "F3", prozent: 0 },
              { label: "F4", prozent: 1 },
              { label: "F5", prozent: 1 },
              { label: "F6", prozent: 1 },
              { label: "F7", prozent: 1 },
            ],
          },
        },
        kontingent: {
          limit: 10,
          verbraucht: 2,
          verbleibend: 8,
          reset_at: "2026-12-01T00:00:00Z",
          tarif: "free",
        },
      },
      "2026-11-18",
    );

    expect(normalized.medianCents).toBe(31_234_550);
    expect(normalized.asOfDate).toBe("2026-10-01");
    expect(normalized.confidence).toBe("high");
    expect(normalized.confidenceScore).toBe(82);
    expect(normalized.limitations).toEqual(["Punkt 1", "Punkt 2"]);
    expect(normalized.factors).toHaveLength(6);
    expect(normalized.factors[0]).toEqual({ label: "F1", effect: "up" });
    expect(normalized.factors[1]).toEqual({ label: "F2", effect: "down" });
    expect(normalized.factors[2]).toEqual({ label: "F3", effect: "neutral" });

    expect(
      normalizeQuota({
        limit: 10,
        verbraucht: 2,
        verbleibend: 8,
        reset_at: "2026-12-01T00:00:00Z",
        tarif: "free",
      }),
    ).toEqual({
      limit: 10,
      used: 2,
      remaining: 8,
      resetAt: "2026-12-01T00:00:00Z",
      tariff: "free",
    });
  });

  it("never includes local valuation adjustments in serialized requestJson", () => {
    const contextInput = {
      asOfDate: "2026-11-18",
      usage: "owner_occupied" as const,
      propertyType: "efh" as const,
      postalCode: "12345",
      city: "Musterstadt",
      livingAreaSqm: 140,
      plotAreaSqm: 400,
      constructionYear: 2010,
      energyClass: "B" as const,
      renovations: [],
      monthlyColdRentCents: null,
      forbiddenTerms: { street: "Musterstraße", houseNumber: "1" },
    };

    const builtWithout = buildPropertyValuationContext(contextInput);
    const builtWith = buildPropertyValuationContext({
      ...contextInput,
      // Local adjustments must never enter context or requestJson
      ...({
        adjustments: [{ label: "Fertighaus Musterweg", bps: -1_000 }],
      } as Record<string, unknown>),
    });

    expect(builtWithout.ok).toBe(true);
    expect(builtWith.ok).toBe(true);
    if (builtWithout.ok && builtWith.ok) {
      const jsonWithout = serializeImmoAnalyseRequest(
        buildImmoAnalyseRequest(builtWithout.context),
      );
      const jsonWith = serializeImmoAnalyseRequest(
        buildImmoAnalyseRequest(builtWith.context),
      );
      expect(jsonWith).toBe(jsonWithout);
      expect(jsonWith).not.toContain("Fertighaus Musterweg");
      expect(jsonWith).not.toContain("-1000");
    }
  });
});
