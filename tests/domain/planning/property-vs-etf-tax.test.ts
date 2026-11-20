import { describe, expect, it } from "vitest";
import {
  calculateAnnualDepreciationCents,
  calculateDepreciationBasisCents,
  calculateEtfLiquidation,
  calculatePropertySale,
  calculateRentalIncomeTaxCents,
  depreciationForMonthCents,
  isWithinSpeculationPeriod,
  validatePropertyVsEtfTaxInput,
  type PropertyVsEtfTaxInput,
} from "@/domain/planning/property-vs-etf-tax";
import { TAX_25D } from "../../fixtures/property-vs-etf-tax-25d";

const TAX_ON: PropertyVsEtfTaxInput = { ...TAX_25D };

describe("AfA", () => {
  it("Basis und Satz", () => {
    expect(calculateDepreciationBasisCents(22_000_000, 8_000)).toBe(17_600_000);
    expect(calculateAnnualDepreciationCents(17_600_000, 200)).toBe(352_000);
    expect(calculateDepreciationBasisCents(22_000_000, 0)).toBe(0);
    expect(calculateAnnualDepreciationCents(17_600_000, 0)).toBe(0);
  });

  it("rundet half-up an der Grenze", () => {
    // 5 × 1000 / 10_000 = 0,5 → 1; 4 × 1000 / 10_000 = 0,4 → 0
    expect(calculateDepreciationBasisCents(5, 1_000)).toBe(1);
    expect(calculateDepreciationBasisCents(4, 1_000)).toBe(0);
    expect(calculateAnnualDepreciationCents(5, 1_000)).toBe(1);
  });

  it("verwirft ungültige Eingaben", () => {
    expect(() => calculateDepreciationBasisCents(-1, 100)).toThrow(RangeError);
    expect(() => calculateAnnualDepreciationCents(1.5, 100)).toThrow(RangeError);
  });

  it("Monatsverteilung: Monate 1–11 floor, Monat 12 Rest", () => {
    const months = Array.from({ length: 12 }, (_, i) =>
      depreciationForMonthCents(352_000, i + 1, 10_000_000),
    );
    expect(months.slice(0, 11).every((m) => m === 29_333)).toBe(true);
    expect(months[11]).toBe(29_337);
    expect(months.reduce((a, b) => a + b, 0)).toBe(352_000);
  });

  it("annual < 12: Monate 1–11 null, Monat 12 Rest", () => {
    const months = Array.from({ length: 12 }, (_, i) =>
      depreciationForMonthCents(7, i + 1, 100),
    );
    expect(months.slice(0, 11).every((m) => m === 0)).toBe(true);
    expect(months[11]).toBe(7);
  });

  it("Deckel auf Restbuchwert", () => {
    expect(depreciationForMonthCents(352_000, 1, 10_000)).toBe(10_000);
    expect(depreciationForMonthCents(352_000, 1, 0)).toBe(0);
  });

  it("wirft bei ungültigem Monat oder negativem Rest", () => {
    expect(() => depreciationForMonthCents(100, 0, 10)).toThrow(RangeError);
    expect(() => depreciationForMonthCents(100, 13, 10)).toThrow(RangeError);
    expect(() => depreciationForMonthCents(100, 1.5, 10)).toThrow(RangeError);
    expect(() => depreciationForMonthCents(100, 1, -1)).toThrow(RangeError);
  });
});

describe("Einkommensteuer (signed)", () => {
  it.each([
    [4_000, 3_000, 1_200],
    [-21_000, 3_000, -6_300],
    [-4, 3_000, -1],
    [5, 3_000, 2],
    [-5, 3_000, -2],
    [-21_000, 0, 0],
    [0, 3_000, 0],
  ])("(%i, %i) → %i", (taxable, rate, expected) => {
    const r = calculateRentalIncomeTaxCents(taxable, rate);
    expect(r).toBe(expected);
    expect(Object.is(r, -0)).toBe(false);
  });

  it("verwirft ungültige Eingaben", () => {
    expect(() => calculateRentalIncomeTaxCents(1.5, 100)).toThrow(RangeError);
    expect(() => calculateRentalIncomeTaxCents(1, -1)).toThrow(RangeError);
  });
});

describe("Spekulationsfrist", () => {
  it("Fristjahr ist noch steuerpflichtig", () => {
    expect(isWithinSpeculationPeriod(10, 10)).toBe(true);
    expect(isWithinSpeculationPeriod(11, 10)).toBe(false);
    expect(isWithinSpeculationPeriod(0, 0)).toBe(true);
  });
});

describe("Immobilienverkauf", () => {
  const base = {
    valueCents: 22_000_000,
    totalCostCents: 22_000_000,
    cumulativeDepreciationCents: 352_000,
    yearsHeld: 1,
    tax: TAX_ON,
  };

  it("Gewinn durch AfA wird versteuert", () => {
    expect(calculatePropertySale(base)).toEqual({
      saleCostsCents: 0,
      netProceedsCents: 22_000_000,
      speculationGainCents: 352_000,
      speculationTaxCents: 105_600,
    });
  });

  it("Verkaufskosten erzeugen Verlust → keine Erstattung", () => {
    expect(
      calculatePropertySale({ ...base, tax: { ...TAX_ON, brokerFeeBps: 500 } }),
    ).toEqual({
      saleCostsCents: 1_100_000,
      netProceedsCents: 20_900_000,
      speculationGainCents: -748_000,
      speculationTaxCents: 0,
    });
  });

  it("nach der Frist steuerfrei", () => {
    expect(calculatePropertySale({ ...base, yearsHeld: 11 }).speculationTaxCents).toBe(0);
  });

  it("Schalter aus: keine Steuer, Verkaufskosten bleiben", () => {
    const r = calculatePropertySale({
      ...base,
      tax: { ...TAX_ON, taxesEnabled: false, brokerFeeBps: 500 },
    });
    expect(r.speculationTaxCents).toBe(0);
    expect(r.saleCostsCents).toBe(1_100_000);
  });

  it("Maximum 20 % Verkaufskosten", () => {
    const r = calculatePropertySale({ ...base, tax: { ...TAX_ON, brokerFeeBps: 2_000 } });
    expect(r.saleCostsCents).toBe(4_400_000);
  });
});

describe("ETF-Liquidation", () => {
  it("26,375 % auf steuerpflichtigen Teil nach Pauschbetrag", () => {
    expect(
      calculateEtfLiquidation({ valueCents: 3_000_000, paidInCents: 2_000_000, tax: TAX_ON }),
    ).toEqual({ etfTaxCents: 158_250, etfLiquidationCents: 2_841_750 });
  });

  it("Gewinn unter Pauschbetrag: keine Steuer", () => {
    expect(
      calculateEtfLiquidation({ valueCents: 2_100_000, paidInCents: 2_000_000, tax: TAX_ON })
        .etfTaxCents,
    ).toBe(0);
  });

  it("Teilfreistellung 0 % und 100 %", () => {
    const v = { valueCents: 3_000_000, paidInCents: 2_000_000 };
    expect(
      calculateEtfLiquidation({ ...v, tax: { ...TAX_ON, partialExemptionBps: 0 } }).etfTaxCents,
    ).toBe(237_375);
    expect(
      calculateEtfLiquidation({ ...v, tax: { ...TAX_ON, partialExemptionBps: 10_000 } }).etfTaxCents,
    ).toBe(0);
  });

  it("Verlust: keine Steuer; Schalter aus: Wert unverändert", () => {
    expect(
      calculateEtfLiquidation({ valueCents: 1_000_000, paidInCents: 2_000_000, tax: TAX_ON })
        .etfTaxCents,
    ).toBe(0);
    expect(
      calculateEtfLiquidation({
        valueCents: 3_000_000,
        paidInCents: 2_000_000,
        tax: { ...TAX_ON, taxesEnabled: false },
      }),
    ).toEqual({ etfTaxCents: 0, etfLiquidationCents: 3_000_000 });
  });

  it("Kirchensteuer wird weitergereicht", () => {
    const v = { valueCents: 3_000_000, paidInCents: 2_000_000 };
    const a = calculateEtfLiquidation({ ...v, tax: TAX_ON }).etfTaxCents;
    const b = calculateEtfLiquidation({ ...v, tax: { ...TAX_ON, churchTaxBps: 900 } }).etfTaxCents;
    expect(b).not.toBe(a);
  });
});

describe("validatePropertyVsEtfTaxInput", () => {
  it("akzeptiert Defaults", () => {
    expect(() => validatePropertyVsEtfTaxInput(TAX_ON)).not.toThrow();
  });

  it.each([
    ["marginalTaxRateBps", -1],
    ["marginalTaxRateBps", 5_001],
    ["marginalTaxRateBps", 30.5],
    ["marginalTaxRateBps", NaN],
    ["depreciationRateBps", -1],
    ["depreciationRateBps", 1_001],
    ["buildingShareBps", -1],
    ["buildingShareBps", 10_001],
    ["speculationPeriodYears", -1],
    ["speculationPeriodYears", 41],
    ["saverAllowanceCents", -1],
    ["saverAllowanceCents", 200_001],
    ["partialExemptionBps", -1],
    ["partialExemptionBps", 10_001],
    ["brokerFeeBps", -1],
    ["brokerFeeBps", 2_001],
    ["churchTaxBps", 500],
  ])("%s = %s wirft RangeError", (key, value) => {
    expect(() => validatePropertyVsEtfTaxInput({ ...TAX_ON, [key]: value })).toThrow(RangeError);
  });

  it("Schalter kein Boolean → TypeError", () => {
    expect(() =>
      validatePropertyVsEtfTaxInput({ ...TAX_ON, taxesEnabled: "ja" as unknown as boolean }),
    ).toThrow(TypeError);
  });
});
