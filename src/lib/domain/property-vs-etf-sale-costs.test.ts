import { describe, expect, it } from "vitest";
import {
  calculatePropertySale,
  reserveDeductionForYearCents,
  totalSaleCostsBps,
  validatePropertyVsEtfTaxInput,
} from "./property-vs-etf-tax";
import { TAX_25D } from "./__fixtures__/property-vs-etf-tax-25d";

const sale = (value: number, tax = TAX_25D) =>
  calculatePropertySale({
    valueCents: value,
    totalCostCents: 20_000_000,
    cumulativeDepreciationCents: 0,
    yearsHeld: 3,
    tax,
  });

describe("totalSaleCostsBps", () => {
  it("summiert Makler und Sonstiges", () => {
    expect(totalSaleCostsBps({ brokerFeeBps: 357, otherSaleCostsBps: 30 })).toBe(387);
    expect(totalSaleCostsBps({ brokerFeeBps: 0, otherSaleCostsBps: 0 })).toBe(0);
    expect(totalSaleCostsBps({ brokerFeeBps: 2_000, otherSaleCostsBps: 1_000 })).toBe(3_000);
  });
  it("wirft bei negativen und nicht ganzzahligen Werten", () => {
    expect(() => totalSaleCostsBps({ brokerFeeBps: -1, otherSaleCostsBps: 0 })).toThrow();
    expect(() => totalSaleCostsBps({ brokerFeeBps: 1.5, otherSaleCostsBps: 0 })).toThrow();
    expect(() => totalSaleCostsBps({ brokerFeeBps: 0, otherSaleCostsBps: -1 })).toThrow();
  });
});

describe("Verkaufskosten in calculatePropertySale", () => {
  it.each([0, 1, 357, 2_000])("Makler %i + Sonstiges 0 = altes saleCostsBps", (x) => {
    const r = sale(25_000_000, { ...TAX_25D, brokerFeeBps: x });
    expect(r.saleCostsCents).toBe(Math.round((25_000_000 * x) / 10_000));
  });

  it("rundet einmal auf die Summe (nicht je Posten)", () => {
    // 1 000 001 × 387 / 10 000 = 38 700,0387 → 38 700.
    expect(sale(1_000_001, { ...TAX_25D, brokerFeeBps: 357, otherSaleCostsBps: 30 }).saleCostsCents).toBe(38_700);
    // Wert 100, je 25 bps: einzeln 0,25 → 0 + 0 = 0, Summe 0,5 → 1 (half-up).
    expect(sale(100, { ...TAX_25D, brokerFeeBps: 25, otherSaleCostsBps: 25 }).saleCostsCents).toBe(1);
    // Wert 200, je 25 bps: einzeln 0,5 → 1 + 1 = 2, Summe 1,0 → 1.
    expect(sale(200, { ...TAX_25D, brokerFeeBps: 25, otherSaleCostsBps: 25 }).saleCostsCents).toBe(1);
  });

  it("hohe Verkaufskosten ohne Wertsteigerung: Verlust, keine Spekulationssteuer", () => {
    const r = calculatePropertySale({
      valueCents: 20_000_000,
      totalCostCents: 20_000_000,
      cumulativeDepreciationCents: 0,
      yearsHeld: 2,
      tax: { ...TAX_25D, brokerFeeBps: 2_000, otherSaleCostsBps: 1_000 },
    });
    expect(r.speculationGainCents).toBeLessThan(0);
    expect(r.speculationTaxCents).toBe(0);
  });

  it("wirken auch bei Steuern aus", () => {
    const r = sale(20_000_000, { ...TAX_25D, taxesEnabled: false, brokerFeeBps: 357, otherSaleCostsBps: 30 });
    expect(r.saleCostsCents).toBe(774_000);
    expect(r.netProceedsCents).toBe(20_000_000 - 774_000);
  });
});

describe("reserveDeductionForYearCents", () => {
  const byYear = [0, 100, 200, 300];
  it.each([
    [1, 0, 100],
    [3, 0, 300],
    [1, 1, 0],
    [2, 1, 100],
    [3, 2, 100],
    [3, 5, 0],
  ])("Jahr %i, Verzögerung %i → %i", (y, l, expected) => {
    expect(reserveDeductionForYearCents(byYear, y, l)).toBe(expected);
  });
  it.each([
    [0, 0],
    [1, -1],
    [1, 1.5],
    [1.5, 0],
    [9, 0],
  ])("Jahr %s, Verzögerung %s wirft RangeError", (y, l) => {
    expect(() => reserveDeductionForYearCents(byYear, y, l)).toThrow(RangeError);
  });
});

describe("Validierung der neuen Steuerfelder", () => {
  it.each([
    ["brokerFeeBps", -1],
    ["brokerFeeBps", 2_001],
    ["otherSaleCostsBps", -1],
    ["otherSaleCostsBps", 1_001],
    ["reserveDeductionLagYears", -1],
    ["reserveDeductionLagYears", 16],
    ["reserveDeductionLagYears", 2.5],
  ])("%s = %s wirft RangeError", (key, value) => {
    expect(() => validatePropertyVsEtfTaxInput({ ...TAX_25D, [key]: value })).toThrow(RangeError);
  });
  it("Grenzen sind gültig", () => {
    expect(() =>
      validatePropertyVsEtfTaxInput({ ...TAX_25D, brokerFeeBps: 2_000, otherSaleCostsBps: 1_000, reserveDeductionLagYears: 15 }),
    ).not.toThrow();
  });
});
