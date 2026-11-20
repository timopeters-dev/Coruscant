import { describe, expect, it } from "vitest";
import {
  simulatePropertyVsEtf,
  type PropertyVsEtfInput,
} from "./property-vs-etf";
import type { PropertyVsEtfTaxInput } from "./property-vs-etf-tax";
import { applyMonthlyGrowth, computeMonthlyGrowthFactor } from "./scenarios";
import { TAX_25D } from "./__fixtures__/property-vs-etf-tax-25d";

const BASE_B: PropertyVsEtfInput = {
  purchasePriceCents: 20_000_000,
  livingAreaCentiSqm: 5000,
  coldRentPerSqmCents: 1000,
  purchaseCostsBps: 1000,
  equityCents: 2_000_000,
  interestRateBps: 0,
  initialRepaymentBps: 200,
  rentGrowthBps: 0,
  valueGrowthBps: 0,
  costGrowthBps: 0,
  vacancyBps: 200,
  monthlyHoaCostsCents: 3000,
  maintenanceReserveBps: 100,
  etfAnnualReturnBps: 0,
  horizonYears: 2,
};
const TAX_OFF: PropertyVsEtfTaxInput = { ...TAX_25D, taxesEnabled: false };

describe("Handrechnung F: verschobene Erstattung (Rücklage-Verzögerung)", () => {
  const run = (lag: number) =>
    simulatePropertyVsEtf(BASE_B, { ...TAX_25D, reserveDeductionLagYears: lag });
  const [l0, l1, l5] = [run(0), run(1), run(5)];

  it.each([
    ["J1 reserveDeductionYearCents", (r: typeof l0) => r.years[1]!.reserveDeductionYearCents, [200_004, 0, 0]],
    ["J1 taxableRentalIncomeYearCents", (r: typeof l0) => r.years[1]!.taxableRentalIncomeYearCents, [-4, 200_000, 200_000]],
    ["J1 rentalIncomeTaxYearCents", (r: typeof l0) => r.years[1]!.rentalIncomeTaxYearCents, [-1, 59_999, 59_999]],
    ["J1 cashflowBeforeTaxYearCents", (r: typeof l0) => r.years[1]!.cashflowBeforeTaxYearCents, [-48_000, -48_000, -48_000]],
    ["J1 cashflowYearCents", (r: typeof l0) => r.years[1]!.cashflowYearCents, [-47_999, -107_999, -107_999]],
    ["J1 etfPaidInCents", (r: typeof l0) => r.years[1]!.etfPaidInCents, [2_047_999, 2_107_999, 2_107_999]],
    ["J2 reserveDeductionYearCents", (r: typeof l0) => r.years[2]!.reserveDeductionYearCents, [200_004, 200_004, 0]],
    ["J2 rentalIncomeTaxYearCents", (r: typeof l0) => r.years[2]!.rentalIncomeTaxYearCents, [-1, -1, 59_999]],
    ["J2 etfPaidInCents", (r: typeof l0) => r.years[2]!.etfPaidInCents, [2_095_998, 2_155_998, 2_215_998]],
    ["J1 propertyLiquidationCents", (r: typeof l0) => r.years[1]!.propertyLiquidationCents, [399_996, 399_996, 399_996]],
    ["J1 advantageCents", (r: typeof l0) => r.years[1]!.advantageCents, [-1_648_003, -1_708_003, -1_708_003]],
    ["J2 advantageCents", (r: typeof l0) => r.years[2]!.advantageCents, [-1_296_006, -1_356_006, -1_416_006]],
  ] as const)("%s", (_name, pick, expected) => {
    // Rechenweg: ohne Abzug ist das Ergebnis je Monat 50 000 − 1 000 − 3 000 − 29 333
    // = 16 667, Steuer 5 000 (Monat 12: 16 663 → 4 999), Jahr 59 999. Der Cashflow vor
    // Steuern bleibt −4 000 je Monat, die Zuzahlung steigt um die Steuerdifferenz.
    expect([pick(l0), pick(l1), pick(l5)]).toEqual([...expected]);
  });
});

describe("Handrechnung G: Überschuss-Depot nach einem Jahr", () => {
  const base: PropertyVsEtfInput = {
    ...BASE_B,
    coldRentPerSqmCents: 2000,
    etfAnnualReturnBps: 600,
    horizonYears: 1,
    reinvestSurplus: true,
  };

  /** Leitet das Depot über dieselben Primitive in einer Schleife her. */
  function derive(monthly: number[]) {
    const factor = computeMonthlyGrowthFactor(600);
    let depot = 0;
    let paid = 0;
    for (const cf of monthly) {
      depot = applyMonthlyGrowth(depot, factor);
      depot += cf;
      paid += cf;
    }
    return { depot, paid };
  }

  it("Steuern aus", () => {
    const r = simulatePropertyVsEtf(base, TAX_OFF);
    const y = r.years[1]!;
    const d = derive(Array(12).fill(45_000));
    expect(y.surplusDepotPaidInCents).toBe(540_000);
    expect(y.accumulatedSurplusCents).toBe(540_000);
    expect(y.surplusDepotValueCents).toBe(d.depot);
    expect(y.surplusDepotValueCents).toBe(554_693);
    expect(y.surplusDepotTaxCents).toBe(0);
    expect(y.propertyLiquidationWithoutDepotCents).toBe(939_996);
    expect(y.propertyLiquidationCents).toBe(954_689);
    expect(y.etfLiquidationCents).toBe(2_119_999);
    expect(y.advantageCents).toBe(-1_165_310);
  });

  it("Steuern an", () => {
    const r = simulatePropertyVsEtf(base, TAX_25D);
    const y = r.years[1]!;
    const d = derive([...Array(11).fill(30_300), 30_301]);
    expect(y.surplusDepotPaidInCents).toBe(363_601);
    expect(y.surplusDepotValueCents).toBe(d.depot);
    expect(y.surplusDepotValueCents).toBe(373_496);
    expect(y.surplusDepotValueCents - y.surplusDepotPaidInCents).toBe(9_895);
    expect(y.surplusDepotTaxCents).toBe(0); // 6 927 < Sparerpauschbetrag
    expect(y.surplusDepotNetCents).toBe(373_496);
    expect(y.propertyLiquidationWithoutDepotCents).toBe(763_597);
    expect(y.propertyLiquidationCents).toBe(773_492);
    expect(y.advantageCents).toBe(-1_346_507);
    expect(r.final.surplusDepotNetCents).toBe(373_496);
  });

  it("Depotgewinn über dem Sparerpauschbetrag wird besteuert", () => {
    const zero = simulatePropertyVsEtf(base, { ...TAX_25D, saverAllowanceCents: 0 });
    expect(zero.years[1]!.surplusDepotTaxCents).toBe(1_827);
    expect(zero.years[1]!.surplusDepotNetCents).toBe(373_496 - 1_827);
    const withAllowance = simulatePropertyVsEtf(base, {
      ...TAX_25D,
      saverAllowanceCents: 100_000,
    });
    expect(withAllowance.years[1]!.surplusDepotTaxCents).toBe(0);
  });

  it("Schalter aus: 25d-Werte, Depotfelder 0", () => {
    const off = { ...base, reinvestSurplus: false };
    const a = simulatePropertyVsEtf(off, TAX_OFF).years[1]!;
    const b = simulatePropertyVsEtf(off, TAX_25D).years[1]!;
    expect(a.propertyLiquidationCents).toBe(939_996);
    expect(b.propertyLiquidationCents).toBe(763_597);
    expect(a.surplusDepotValueCents).toBe(0);
    expect(b.surplusDepotNetCents).toBe(0);
  });
});

describe("Reinvestition & Verzögerung: Grenzfälle", () => {
  it("nur negativer Cashflow: Ergebnis gleich Schalter aus", () => {
    const x = { ...BASE_B, horizonYears: 5 };
    const on = simulatePropertyVsEtf({ ...x, reinvestSurplus: true }, TAX_25D);
    const off = simulatePropertyVsEtf({ ...x, reinvestSurplus: false }, TAX_25D);
    for (const row of on.years) {
      expect(row.surplusDepotValueCents).toBe(0);
      expect(row.surplusDepotPaidInCents).toBe(0);
      expect(row.surplusDepotTaxCents).toBe(0);
      expect(row.propertyLiquidationCents).toBe(
        row.propertyLiquidationWithoutDepotCents,
      );
    }
    expect(on.final.advantageCents).toBe(off.final.advantageCents);
    expect(on.years.map((y) => y.propertyLiquidationCents)).toEqual(
      off.years.map((y) => y.propertyLiquidationCents),
    );
  });

  it("Cashflow kippt ins Negative: Einzahlungen stoppen, Depot wächst weiter", () => {
    const x: PropertyVsEtfInput = {
      ...BASE_B,
      coldRentPerSqmCents: 2400,
      rentGrowthBps: -1_000,
      etfAnnualReturnBps: 600,
      horizonYears: 10,
    };
    const on = simulatePropertyVsEtf({ ...x, reinvestSurplus: true }, TAX_25D);
    const off = simulatePropertyVsEtf(x, TAX_25D);
    const flipYear = on.years.findIndex(
      (row, i) => i > 0 && row.etfTopUpYearCents > 0,
    );
    expect(flipYear).toBeGreaterThan(1);
    const before = on.years[flipYear - 1]!;
    expect(before.surplusDepotPaidInCents).toBeGreaterThan(0);
    // Ab dem Kipp-Jahr ohne weitere Überschüsse: Einzahlungen konstant, Wert wächst.
    const last = on.years[10]!;
    const prev = on.years[9]!;
    expect(last.surplusYearCents).toBe(0);
    expect(prev.surplusYearCents).toBe(0);
    expect(last.surplusDepotPaidInCents).toBe(prev.surplusDepotPaidInCents);
    expect(last.surplusDepotValueCents).toBeGreaterThan(
      prev.surplusDepotValueCents,
    );
    // ETF-Seite, Cashflow, Steuer, Restschuld unabhängig vom Schalter
    on.years.forEach((row, i) => {
      const o = off.years[i]!;
      expect(row.etfValueCents).toBe(o.etfValueCents);
      expect(row.etfPaidInCents).toBe(o.etfPaidInCents);
      expect(row.etfLiquidationCents).toBe(o.etfLiquidationCents);
      expect(row.etfTopUpYearCents).toBe(o.etfTopUpYearCents);
      expect(row.cashflowYearCents).toBe(o.cashflowYearCents);
      expect(row.rentalIncomeTaxYearCents).toBe(o.rentalIncomeTaxYearCents);
      expect(row.remainingDebtCents).toBe(o.remainingDebtCents);
      expect(row.propertyLiquidationWithoutDepotCents).toBe(
        o.propertyLiquidationCents,
      );
    });
  });

  it("Verzögerung größer als der Horizont: nie ein Abzug", () => {
    const r = simulatePropertyVsEtf(
      { ...BASE_B, horizonYears: 10 },
      { ...TAX_25D, reserveDeductionLagYears: 15 },
    );
    for (const row of r.years) expect(row.reserveDeductionYearCents).toBe(0);
    expect(r.flags.reserveDeductionDeferred).toBe(true);
    expect(r.reserveDeductionLagYears).toBe(15);
  });

  it("Verzögerung 0 setzt kein reserveDeductionDeferred", () => {
    const r = simulatePropertyVsEtf(BASE_B, TAX_25D);
    expect(r.flags.reserveDeductionDeferred).toBe(false);
  });

  it("Verzögerung bei Steuern aus ohne Wirkung", () => {
    const x = { ...BASE_B, horizonYears: 5 };
    const a = simulatePropertyVsEtf(x, { ...TAX_OFF, reserveDeductionLagYears: 0 });
    const b = simulatePropertyVsEtf(x, { ...TAX_OFF, reserveDeductionLagYears: 15 });
    expect(b).toEqual(a);
    expect(b.reserveDeductionLagYears).toBe(0);
    for (const row of b.years) expect(row.reserveDeductionYearCents).toBe(0);
    expect(b.flags.reserveDeductionDeferred).toBe(false);
  });

  it("Horizont 1 mit Verzögerung 5 und Reinvestition: kein Abzug, Depot wie G", () => {
    const x: PropertyVsEtfInput = {
      ...BASE_B,
      coldRentPerSqmCents: 2000,
      etfAnnualReturnBps: 600,
      horizonYears: 1,
      reinvestSurplus: true,
    };
    const r = simulatePropertyVsEtf(x, { ...TAX_25D, reserveDeductionLagYears: 5 });
    expect(r.years[1]!.reserveDeductionYearCents).toBe(0);
    expect(r.years[1]!.surplusDepotPaidInCents).toBeGreaterThan(0);
  });

  it("Cashflow vor Steuern ist unabhängig von der Verzögerung", () => {
    const x = { ...BASE_B, valueGrowthBps: 300, horizonYears: 8 };
    const runs = [0, 5, 15].map((lag) =>
      simulatePropertyVsEtf(x, { ...TAX_25D, reserveDeductionLagYears: lag }),
    );
    runs[0]!.years.forEach((row, i) => {
      for (const r of runs) {
        expect(r.years[i]!.cashflowBeforeTaxYearCents).toBe(
          row.cashflowBeforeTaxYearCents,
        );
      }
    });
  });

  it("Summe der Abzüge = Rücklagen der Jahre 1 … H − L", () => {
    const x = { ...BASE_B, valueGrowthBps: 300, horizonYears: 10 };
    const lag = 3;
    const r = simulatePropertyVsEtf(x, { ...TAX_25D, reserveDeductionLagYears: lag });
    const deducted = r.years.reduce((s, y) => s + y.reserveDeductionYearCents, 0);
    const paid = r.years
      .slice(1, 10 - lag + 1)
      .reduce((s, y) => s + y.maintenanceReserveYearCents, 0);
    expect(deducted).toBe(paid);
    expect(r.years[10]!.reserveDeductionYearCents).toBe(
      r.years[7]!.maintenanceReserveYearCents,
    );
  });

  it("Validierung", () => {
    expect(() =>
      simulatePropertyVsEtf(
        { ...BASE_B, reinvestSurplus: "ja" as unknown as boolean },
        TAX_25D,
      ),
    ).toThrow(TypeError);
    for (const lag of [-1, 16, 2.5]) {
      expect(() =>
        simulatePropertyVsEtf(BASE_B, { ...TAX_25D, reserveDeductionLagYears: lag }),
      ).toThrow(RangeError);
    }
    expect(() =>
      simulatePropertyVsEtf(BASE_B, { ...TAX_25D, brokerFeeBps: 2_001 }),
    ).toThrow(RangeError);
    expect(() =>
      simulatePropertyVsEtf(BASE_B, { ...TAX_25D, otherSaleCostsBps: 1_001 }),
    ).toThrow(RangeError);
  });

  it("Maximalwerte mit Reinvestition: kein Überlauf", () => {
    const x: PropertyVsEtfInput = {
      purchasePriceCents: 10_000_000_000,
      livingAreaCentiSqm: 100_000,
      coldRentPerSqmCents: 10_000,
      purchaseCostsBps: 0,
      equityCents: 10_000_000_000,
      interestRateBps: 0,
      initialRepaymentBps: 0,
      rentGrowthBps: 1_000,
      valueGrowthBps: 1_000,
      costGrowthBps: 0,
      vacancyBps: 0,
      monthlyHoaCostsCents: 0,
      maintenanceReserveBps: 0,
      etfAnnualReturnBps: 3_000,
      horizonYears: 40,
      reinvestSurplus: true,
    };
    expect(() =>
      simulatePropertyVsEtf(x, TAX_25D),
    ).not.toThrow(/./);
  });

  it("mutiert weder input noch tax", () => {
    const x: PropertyVsEtfInput = {
      ...BASE_B,
      coldRentPerSqmCents: 2000,
      reinvestSurplus: true,
    };
    const t = { ...TAX_25D, reserveDeductionLagYears: 2 };
    const xs = structuredClone(x);
    const ts = structuredClone(t);
    simulatePropertyVsEtf(x, t);
    expect(x).toEqual(xs);
    expect(t).toEqual(ts);
  });
});
