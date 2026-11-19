import { describe, expect, it } from "vitest";
import { CURRENT_PURCHASE_COST_RULE_SET } from "./property-purchase-defaults";
import {
  calculatePurchaseCostsCents,
  defaultEquityCents,
  PROPERTY_VS_ETF_DEFAULTS,
  PROPERTY_VS_ETF_LIMITS,
  PROPERTY_VS_ETF_SLIDER_RANGES,
  PROPERTY_VS_ETF_TAX_DEFAULTS,
  PROPERTY_VS_ETF_TAX_LIMITS,
  sumPurchaseCostRuleSetBps,
} from "./property-vs-etf-defaults";
import { simulatePropertyVsEtf } from "./property-vs-etf";
import {
  validatePropertyVsEtfTaxInput,
  type PropertyVsEtfTaxInput,
} from "./property-vs-etf-tax";
import { MAX_ETF_RETURN_BPS, MIN_ETF_RETURN_BPS } from "./scenarios";

describe("property-vs-etf-defaults", () => {
  it("summiert das aktuelle Regelwerk auf 1207 bps", () => {
    expect(sumPurchaseCostRuleSetBps(CURRENT_PURCHASE_COST_RULE_SET)).toBe(1207);
    expect(PROPERTY_VS_ETF_DEFAULTS.purchaseCostsBps).toBe(1207);
  });

  it("rundet Nebenkosten half-up an der 0,5-Cent-Grenze", () => {
    // 5 × 1000 / 10_000 = 0,5 → 1
    expect(calculatePurchaseCostsCents(5, 1000)).toBe(1);
    // 4 × 1000 / 10_000 = 0,4 → 0
    expect(calculatePurchaseCostsCents(4, 1000)).toBe(0);
    expect(calculatePurchaseCostsCents(20_000_000, 1000)).toBe(2_000_000);
    expect(calculatePurchaseCostsCents(0, 1000)).toBe(0);
  });

  it("verwirft ungültige Eingaben", () => {
    expect(() => calculatePurchaseCostsCents(-1, 100)).toThrow(RangeError);
    expect(() => calculatePurchaseCostsCents(1.5, 100)).toThrow(RangeError);
  });

  it("defaultEquityCents entspricht den Nebenkosten", () => {
    expect(defaultEquityCents(30_000_000, 1207)).toBe(
      calculatePurchaseCostsCents(30_000_000, 1207),
    );
  });

  it("hält ETF-Grenzen synchron mit scenarios.ts", () => {
    expect(PROPERTY_VS_ETF_LIMITS.etfAnnualReturnBps).toEqual({
      min: MIN_ETF_RETURN_BPS,
      max: MAX_ETF_RETURN_BPS,
    });
  });

  it("Defaults liegen innerhalb der Limits", () => {
    for (const [key, value] of Object.entries(PROPERTY_VS_ETF_DEFAULTS)) {
      const range = PROPERTY_VS_ETF_LIMITS[key as keyof typeof PROPERTY_VS_ETF_LIMITS];
      expect(value).toBeGreaterThanOrEqual(range.min);
      expect(value).toBeLessThanOrEqual(range.max);
    }
  });

  it("Slider-Bereiche liegen innerhalb der Limits", () => {
    for (const [key, r] of Object.entries(PROPERTY_VS_ETF_SLIDER_RANGES)) {
      const range = PROPERTY_VS_ETF_LIMITS[key as keyof typeof PROPERTY_VS_ETF_LIMITS];
      expect(r.min).toBeGreaterThanOrEqual(range.min);
      expect(r.max).toBeLessThanOrEqual(range.max);
    }
  });

  it("Smoke: Standardszenario läuft über 20 Jahre", () => {
    const purchasePriceCents = 30_000_000;
    const result = simulatePropertyVsEtf({
      ...PROPERTY_VS_ETF_DEFAULTS,
      purchasePriceCents,
      livingAreaCentiSqm: 7000,
      coldRentPerSqmCents: 1200,
      equityCents: defaultEquityCents(
        purchasePriceCents,
        PROPERTY_VS_ETF_DEFAULTS.purchaseCostsBps,
      ),
    });
    expect(result.years).toHaveLength(21);
  });

  describe("Steuer-Defaults", () => {
    it("sind als PropertyVsEtfTaxInput zuweisbar und gültig", () => {
      const tax: PropertyVsEtfTaxInput = PROPERTY_VS_ETF_TAX_DEFAULTS;
      expect(() => validatePropertyVsEtfTaxInput(tax)).not.toThrow();
    });

    it("entsprechen der Roadmap", () => {
      expect(PROPERTY_VS_ETF_TAX_DEFAULTS).toEqual({
        taxesEnabled: true,
        marginalTaxRateBps: 3_000,
        depreciationRateBps: 200,
        buildingShareBps: 8_000,
        speculationPeriodYears: 10,
        saverAllowanceCents: 100_000,
        partialExemptionBps: 3_000,
        churchTaxBps: 0,
        saleCostsBps: 0,
      });
    });

    it("liegen innerhalb der Limits", () => {
      for (const [key, range] of Object.entries(PROPERTY_VS_ETF_TAX_LIMITS)) {
        const value = PROPERTY_VS_ETF_TAX_DEFAULTS[key as keyof typeof PROPERTY_VS_ETF_TAX_LIMITS];
        expect(value).toBeGreaterThanOrEqual(range.min);
        expect(value).toBeLessThanOrEqual(range.max);
      }
    });
  });
});
