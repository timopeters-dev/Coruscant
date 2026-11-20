import { describe, expect, it } from "vitest";
import fixture from "../../fixtures/property-vs-etf-25d.json";
import {
  simulatePropertyVsEtf,
  type PropertyVsEtfInput,
} from "@/domain/planning/property-vs-etf";
import type { PropertyVsEtfTaxInput } from "@/domain/planning/property-vs-etf-tax";

interface LegacyTax {
  taxesEnabled: boolean;
  marginalTaxRateBps: number;
  depreciationRateBps: number;
  buildingShareBps: number;
  speculationPeriodYears: number;
  saverAllowanceCents: number;
  partialExemptionBps: number;
  churchTaxBps: number;
  saleCostsBps: number;
}

function translate(legacy: LegacyTax | null): PropertyVsEtfTaxInput | undefined {
  if (legacy === null) return undefined;
  const { saleCostsBps, ...rest } = legacy;
  return {
    ...rest,
    brokerFeeBps: saleCostsBps,
    otherSaleCostsBps: 0,
    reserveDeductionLagYears: 0,
  };
}

const NAMES = ["S1", "S2", "S3", "S4"] as const;

describe("Regression gegen eingefrorenes 25d-Ergebnis", () => {
  it.each(NAMES)("%s: bitgenau gleich 25d", (name) => {
    const scenario = fixture[name] as unknown as {
      input: PropertyVsEtfInput;
      tax: LegacyTax | null;
      result: unknown;
    };
    const result = simulatePropertyVsEtf(
      scenario.input,
      translate(scenario.tax),
    );
    expect(result).toMatchObject(scenario.result as object);

    for (const row of result.years) {
      expect(row.propertyLiquidationWithoutDepotCents).toBe(
        row.propertyLiquidationCents,
      );
      expect(row.reserveDeductionYearCents).toBe(
        result.taxesEnabled ? row.maintenanceReserveYearCents : 0,
      );
      expect(row.surplusDepotValueCents).toBe(0);
      expect(row.surplusDepotPaidInCents).toBe(0);
      expect(row.surplusDepotTaxCents).toBe(0);
      expect(row.surplusDepotNetCents).toBe(0);
    }
  });

  it("explizit reinvestSurplus: false ändert nichts", () => {
    const s = fixture.S3 as unknown as {
      input: PropertyVsEtfInput;
      tax: LegacyTax;
      result: unknown;
    };
    const result = simulatePropertyVsEtf(
      { ...s.input, reinvestSurplus: false },
      translate(s.tax),
    );
    expect(result).toMatchObject(s.result as object);
  });
});
