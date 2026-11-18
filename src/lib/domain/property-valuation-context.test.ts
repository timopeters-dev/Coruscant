import { describe, expect, it } from "vitest";
import {
  assertValuationContextSafe,
  buildPropertyValuationContext,
  serializePropertyValuationContext,
  ValuationContextPiiError,
  type PropertyValuationContextInput,
} from "./property-valuation-context";

function makeBaseInput(
  overrides: Partial<PropertyValuationContextInput> = {},
): PropertyValuationContextInput {
  return {
    asOfDate: "2026-11-18",
    usage: "rented",
    postalCode: "12345",
    city: "Musterstadt",
    livingAreaSqm: 85,
    plotAreaSqm: 240,
    constructionYear: 1998,
    energyClass: "C",
    renovations: [
      { year: 2019, kind: "roof" },
      { year: 2021, kind: "heating" },
    ],
    monthlyColdRentCents: 102_000,
    forbiddenTerms: {
      street: "Musterstraße",
      houseNumber: "1",
    },
    ...overrides,
  };
}

function collectAllKeys(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((item) => collectAllKeys(item));
  }
  if (typeof value === "object" && value !== null) {
    return Object.entries(value).flatMap(([key, child]) => [
      key,
      ...collectAllKeys(child),
    ]);
  }
  return [];
}

describe("property-valuation-context", () => {
  it("builds a complete context with stable key order and exact serialized JSON", () => {
    const result = buildPropertyValuationContext(makeBaseInput());
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const json = serializePropertyValuationContext(result.context);
    expect(json).toBe(
      `{
  "schemaVersion": 1,
  "asOfMonth": "2026-11",
  "location": {
    "country": "DE",
    "postalCode": "12345",
    "city": "Musterstadt"
  },
  "object": {
    "usage": "rented",
    "livingAreaSqm": 85,
    "plotAreaSqm": 240,
    "constructionYear": 1998,
    "energyClass": "C",
    "renovations": [
      {
        "year": 2019,
        "kind": "roof"
      },
      {
        "year": 2021,
        "kind": "heating"
      }
    ]
  },
  "rental": {
    "monthlyColdRentCents": 102000,
    "rentPerSqmCents": 1200
  }
}`,
    );
  });

  it("never leaks street, houseNumber, name, features, or imagePath into serialized context", () => {
    const fullRecord = {
      ...makeBaseInput(),
      name: "Wohnung Musterstraße 1",
      features: "Balkon, Einbauküche, Keller",
      imagePath: "/data/documents/objekt-foto.jpg",
    };

    const result = buildPropertyValuationContext(fullRecord);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const json = serializePropertyValuationContext(result.context);
    expect(json).not.toContain("Musterstraße");
    expect(json).not.toContain("Musterstraße 1");
    expect(json).not.toContain("Wohnung Musterstraße 1");
    expect(json).not.toContain("Balkon");
    expect(json).not.toContain("objekt-foto.jpg");
  });

  it("contains only the exact allowlisted keys recursively", () => {
    const result = buildPropertyValuationContext(makeBaseInput());
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const keys = new Set(collectAllKeys(result.context));
    expect(keys).toEqual(
      new Set([
        "schemaVersion",
        "asOfMonth",
        "location",
        "country",
        "postalCode",
        "city",
        "object",
        "usage",
        "livingAreaSqm",
        "plotAreaSqm",
        "constructionYear",
        "energyClass",
        "renovations",
        "year",
        "kind",
        "rental",
        "monthlyColdRentCents",
        "rentPerSqmCents",
      ]),
    );
  });

  it("normalizes postalCode strictly to 5 German digits", () => {
    expect(
      buildPropertyValuationContext(makeBaseInput({ postalCode: "12345" })),
    ).toMatchObject({ ok: true, context: { location: { postalCode: "12345" } } });

    expect(
      buildPropertyValuationContext(makeBaseInput({ postalCode: " 12345 " })),
    ).toMatchObject({ ok: true, context: { location: { postalCode: "12345" } } });

    for (const invalid of [null, "", "1234", "123456", "D-12345", "12345 Musterstadt"]) {
      expect(
        buildPropertyValuationContext(makeBaseInput({ postalCode: invalid })),
      ).toEqual({ ok: false, reason: "missing_postal_code" });
    }
  });

  it("sanitizes city and nulls out street-like, digit-containing, or email values without blocking", () => {
    expect(
      buildPropertyValuationContext(makeBaseInput({ city: "  Musterstadt  " })),
    ).toMatchObject({ ok: true, context: { location: { city: "Musterstadt" } } });

    for (const unsafeCity of [
      "Musterstraße 1, Musterstadt",
      "Musterweg",
      "Musterstadt 5",
      "info@musterstadt.de",
    ]) {
      expect(
        buildPropertyValuationContext(makeBaseInput({ city: unsafeCity })),
      ).toMatchObject({ ok: true, context: { location: { city: null } } });
    }
  });

  it("returns missing_living_area when livingAreaSqm is missing or non-positive", () => {
    expect(
      buildPropertyValuationContext(makeBaseInput({ livingAreaSqm: null })),
    ).toEqual({ ok: false, reason: "missing_living_area" });

    expect(
      buildPropertyValuationContext(makeBaseInput({ livingAreaSqm: 0 })),
    ).toEqual({ ok: false, reason: "missing_living_area" });
  });

  it("includes rental only when usage is rented and cold rent > 0, rounding rentPerSqmCents half-up", () => {
    const ownerOccupied = buildPropertyValuationContext(
      makeBaseInput({ usage: "owner_occupied", monthlyColdRentCents: 100_000 }),
    );
    expect(ownerOccupied).toMatchObject({ ok: true, context: { rental: null } });

    const zeroRent = buildPropertyValuationContext(
      makeBaseInput({ usage: "rented", monthlyColdRentCents: 0 }),
    );
    expect(zeroRent).toMatchObject({ ok: true, context: { rental: null } });

    // 105 cents / 2 sqm = 52.5 -> 53 cents (half-up)
    const halfUp = buildPropertyValuationContext(
      makeBaseInput({
        usage: "rented",
        livingAreaSqm: 2,
        monthlyColdRentCents: 105,
      }),
    );
    expect(halfUp).toMatchObject({
      ok: true,
      context: { rental: { monthlyColdRentCents: 105, rentPerSqmCents: 53 } },
    });
  });

  it("filters out renovations in the future or before constructionYear", () => {
    const result = buildPropertyValuationContext(
      makeBaseInput({
        asOfDate: "2026-11-18",
        constructionYear: 2000,
        renovations: [
          { year: 1995, kind: "roof" },
          { year: 2015, kind: "windows" },
          { year: 2028, kind: "heating" },
        ],
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.context.object.renovations).toEqual([
      { year: 2015, kind: "windows" },
    ]);
  });

  describe("assertValuationContextSafe", () => {
    it("throws when city matches street (injected)", () => {
      const built = buildPropertyValuationContext(makeBaseInput());
      expect(built.ok).toBe(true);
      if (!built.ok) return;

      const tampered = {
        ...built.context,
        location: { ...built.context.location, city: "Musterstraße" },
      };

      expect(() =>
        assertValuationContextSafe(tampered, {
          street: "Musterstraße",
          houseNumber: "1",
        }),
      ).toThrow(ValuationContextPiiError);
    });

    it("throws when IBAN or email is injected into city", () => {
      const built = buildPropertyValuationContext(makeBaseInput());
      expect(built.ok).toBe(true);
      if (!built.ok) return;

      const withIban = {
        ...built.context,
        location: {
          ...built.context.location,
          city: "DE89 3704 0044 0532 0130 00",
        },
      };
      expect(() =>
        assertValuationContextSafe(withIban, {
          street: "Musterstraße",
          houseNumber: "1",
        }),
      ).toThrow(ValuationContextPiiError);

      const withEmail = {
        ...built.context,
        location: { ...built.context.location, city: "test@example.com" },
      };
      expect(() =>
        assertValuationContextSafe(withEmail, {
          street: "Musterstraße",
          houseNumber: "1",
        }),
      ).toThrow(ValuationContextPiiError);
    });

    it("does not false-positive on cent integers with >= 8 digits", () => {
      const built = buildPropertyValuationContext(
        makeBaseInput({
          usage: "rented",
          monthlyColdRentCents: 12_345_678,
        }),
      );
      expect(built.ok).toBe(true);
      if (!built.ok) return;

      expect(() =>
        assertValuationContextSafe(built.context, {
          street: "Musterstraße",
          houseNumber: "1",
        }),
      ).not.toThrow();
    });
  });
});
