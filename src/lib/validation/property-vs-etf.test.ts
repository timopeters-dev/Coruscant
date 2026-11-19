import { describe, expect, it } from "vitest";
import { simulatePropertyVsEtf } from "../domain/property-vs-etf";
import { propertyVsEtfInputSchema } from "./property-vs-etf";

const valid = {
  purchasePriceCents: 20_000_000,
  livingAreaCentiSqm: 5000,
  coldRentPerSqmCents: 1000,
  purchaseCostsBps: 1000,
  equityCents: 2_000_000,
  interestRateBps: 300,
  initialRepaymentBps: 200,
  rentGrowthBps: 200,
  valueGrowthBps: 200,
  costGrowthBps: 200,
  vacancyBps: 200,
  monthlyHoaCostsCents: 3000,
  maintenanceReserveBps: 100,
  etfAnnualReturnBps: 600,
  horizonYears: 2,
};

type Field = keyof typeof valid;

describe("propertyVsEtfInputSchema", () => {
  it("akzeptiert gültige Eingabe und ist an die Simulation übergebbar", () => {
    const parsed = propertyVsEtfInputSchema.safeParse(valid);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(simulatePropertyVsEtf(parsed.data).years).toHaveLength(3);
    }
  });

  const cases: Record<Field, { under: number; over: number }> = {
    purchasePriceCents: { under: 0, over: 10_000_000_001 },
    livingAreaCentiSqm: { under: 0, over: 100_001 },
    coldRentPerSqmCents: { under: -1, over: 10_001 },
    purchaseCostsBps: { under: -1, over: 3001 },
    equityCents: { under: -1, over: 20_000_000_001 },
    interestRateBps: { under: -1, over: 1501 },
    initialRepaymentBps: { under: -1, over: 1001 },
    rentGrowthBps: { under: -1001, over: 1001 },
    valueGrowthBps: { under: -1001, over: 1001 },
    costGrowthBps: { under: -1001, over: 1001 },
    vacancyBps: { under: -1, over: 5001 },
    monthlyHoaCostsCents: { under: -1, over: 10_000_001 },
    maintenanceReserveBps: { under: -1, over: 501 },
    etfAnnualReturnBps: { under: -5001, over: 3001 },
    horizonYears: { under: 0, over: 41 },
  };

  for (const field of Object.keys(valid) as Field[]) {
    describe(field, () => {
      const fails = (value: unknown, omit = false) => {
        const input: Record<string, unknown> = { ...valid, [field]: value };
        if (omit) delete input[field];
        const res = propertyVsEtfInputSchema.safeParse(input);
        expect(res.success).toBe(false);
        if (!res.success) {
          expect(res.error.issues.some((i) => i.path[0] === field)).toBe(true);
        }
      };
      it("fehlendes Pflichtfeld", () => fails(undefined, true));
      it("String statt Zahl", () => fails("12"));
      it("Dezimalzahl", () => fails(12.5));
      it("unter Minimum", () => fails(cases[field].under));
      it("über Maximum", () => fails(cases[field].over));
    });
  }

  it("EK unter Nebenkosten erzeugt Issue auf equityCents", () => {
    const res = propertyVsEtfInputSchema.safeParse({ ...valid, equityCents: 1_999_999 });
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.error.issues[0]!.path).toEqual(["equityCents"]);
      expect(res.error.issues[0]!.message).toBe(
        "Eigenkapital muss mindestens die Kaufnebenkosten decken",
      );
    }
  });

  it("EK über Gesamtkosten erzeugt Issue auf equityCents", () => {
    const res = propertyVsEtfInputSchema.safeParse({ ...valid, equityCents: 22_000_001 });
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.error.issues[0]!.path).toEqual(["equityCents"]);
      expect(res.error.issues[0]!.message).toBe(
        "Eigenkapital darf Kaufpreis plus Nebenkosten nicht übersteigen",
      );
    }
  });

  it("EK exakt an beiden Grenzen ist gültig", () => {
    expect(propertyVsEtfInputSchema.safeParse({ ...valid, equityCents: 2_000_000 }).success).toBe(true);
    expect(propertyVsEtfInputSchema.safeParse({ ...valid, equityCents: 22_000_000 }).success).toBe(true);
  });

  describe("keine Folgefehler auf equityCents bei ungültigen Basisfeldern", () => {
    const onlyFieldIssue = (over: Record<string, unknown>, field: string) => {
      const res = propertyVsEtfInputSchema.safeParse({ ...valid, ...over });
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.error.issues.some((i) => i.path[0] === "equityCents")).toBe(false);
        expect(res.error.issues.some((i) => i.path[0] === field)).toBe(true);
      }
    };
    it("Kaufpreis über Maximum", () =>
      onlyFieldIssue({ purchasePriceCents: 20_000_000_000 }, "purchasePriceCents"));
    it("Kaufpreis 0", () => onlyFieldIssue({ purchasePriceCents: 0 }, "purchasePriceCents"));
    it("purchaseCostsBps über Maximum", () =>
      onlyFieldIssue({ purchaseCostsBps: 1_000_000 }, "purchaseCostsBps"));
  });

  it("equityCents -1: genau ein Issue mit Feldmeldung", () => {
    const res = propertyVsEtfInputSchema.safeParse({ ...valid, equityCents: -1 });
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.error.issues).toHaveLength(1);
      expect(res.error.issues[0]!.message).toBe("Eigenkapital: mindestens 0,00 €");
    }
  });
});
