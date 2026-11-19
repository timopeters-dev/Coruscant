import { describe, expect, it } from "vitest";
import { simulatePropertyVsEtf } from "../domain/property-vs-etf";
import { PROPERTY_VS_ETF_TAX_DEFAULTS } from "../domain/property-vs-etf-defaults";
import {
  propertyVsEtfInputSchema,
  propertyVsEtfTaxInputSchema,
} from "./property-vs-etf";

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

describe("propertyVsEtfTaxInputSchema", () => {
  const taxValid = { ...PROPERTY_VS_ETF_TAX_DEFAULTS };

  it("akzeptiert die Defaults", () => {
    expect(propertyVsEtfTaxInputSchema.safeParse(taxValid).success).toBe(true);
  });

  const cases: [string, Record<string, unknown>, string, RegExp][] = [
    ["Grenzsteuersatz zu hoch", { marginalTaxRateBps: 5_001 }, "marginalTaxRateBps", /Grenzsteuersatz: höchstens 50,00 %/],
    ["Grenzsteuersatz negativ", { marginalTaxRateBps: -1 }, "marginalTaxRateBps", /Grenzsteuersatz/],
    ["Grenzsteuersatz Kommazahl", { marginalTaxRateBps: 30.5 }, "marginalTaxRateBps", /Grenzsteuersatz/],
    ["AfA zu hoch", { depreciationRateBps: 1_001 }, "depreciationRateBps", /AfA-Satz: höchstens 10,00 %/],
    ["Gebäudeanteil zu hoch", { buildingShareBps: 10_001 }, "buildingShareBps", /Gebäudeanteil: höchstens 100,00 %/],
    ["Frist zu hoch", { speculationPeriodYears: 41 }, "speculationPeriodYears", /Spekulationsfrist: ganze Jahre zwischen 0 und 40/],
    ["Frist negativ", { speculationPeriodYears: -1 }, "speculationPeriodYears", /Spekulationsfrist/],
    ["Pauschbetrag zu hoch", { saverAllowanceCents: 200_001 }, "saverAllowanceCents", /Sparerpauschbetrag: höchstens 2.000,00 €/],
    ["Teilfreistellung zu hoch", { partialExemptionBps: 10_001 }, "partialExemptionBps", /Teilfreistellung: höchstens 100,00 %/],
    ["Verkaufskosten zu hoch", { saleCostsBps: 2_001 }, "saleCostsBps", /Verkaufskosten: höchstens 20,00 %/],
    ["KiSt 5 %", { churchTaxBps: 500 }, "churchTaxBps", /Kirchensteuer: 0 %, 8 % oder 9 %/],
    ["AfA negativ", { depreciationRateBps: -1 }, "depreciationRateBps", /AfA-Satz: mindestens 0,00 %/],
    ["Gebäudeanteil negativ", { buildingShareBps: -1 }, "buildingShareBps", /Gebäudeanteil: mindestens 0,00 %/],
    ["Pauschbetrag negativ", { saverAllowanceCents: -1 }, "saverAllowanceCents", /Sparerpauschbetrag: mindestens 0,00 €/],
    ["Teilfreistellung negativ", { partialExemptionBps: -1 }, "partialExemptionBps", /Teilfreistellung: mindestens 0,00 %/],
    ["Verkaufskosten negativ", { saleCostsBps: -1 }, "saleCostsBps", /Verkaufskosten: mindestens 0,00 %/],
    ["Frist Kommazahl", { speculationPeriodYears: 10.5 }, "speculationPeriodYears", /Spekulationsfrist: ganze Jahre/],
    ["Pauschbetrag Kommazahl", { saverAllowanceCents: 100.5 }, "saverAllowanceCents", /Sparerpauschbetrag: ganze Cent erforderlich/],
    ["KiSt als String", { churchTaxBps: "0" }, "churchTaxBps", /Kirchensteuer: 0 %, 8 % oder 9 %/],
    ["Schalter als String", { taxesEnabled: "true" }, "taxesEnabled", /Steuern berücksichtigen/],
  ];

  it.each(cases)("%s", (_name, over, path, message) => {
    const r = propertyVsEtfTaxInputSchema.safeParse({ ...taxValid, ...over });
    expect(r.success).toBe(false);
    if (!r.success) {
      const issue = r.error.issues.find((i) => i.path[0] === path);
      expect(issue?.message).toMatch(message);
    }
  });

  it("akzeptiert KiSt 8 % und 9 %", () => {
    for (const churchTaxBps of [800, 900]) {
      expect(propertyVsEtfTaxInputSchema.safeParse({ ...taxValid, churchTaxBps }).success).toBe(true);
    }
  });
});
