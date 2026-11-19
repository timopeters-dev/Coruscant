import { describe, expect, it } from "vitest";
import {
  simulatePropertyVsEtf,
  type PropertyVsEtfInput,
  type PropertyVsEtfResult,
} from "./property-vs-etf";
import {
  PROPERTY_VS_ETF_DEFAULTS,
  PROPERTY_VS_ETF_TAX_DEFAULTS,
} from "./property-vs-etf-defaults";
import type { PropertyVsEtfTaxInput } from "./property-vs-etf-tax";

const BASE_A: PropertyVsEtfInput = {
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

const BASE_B: PropertyVsEtfInput = {
  ...BASE_A,
  interestRateBps: 0,
  etfAnnualReturnBps: 0,
  rentGrowthBps: 0,
  valueGrowthBps: 0,
  costGrowthBps: 0,
};

const TAX_ON: PropertyVsEtfTaxInput = { ...PROPERTY_VS_ETF_TAX_DEFAULTS };
const TAX_OFF: PropertyVsEtfTaxInput = { ...TAX_ON, taxesEnabled: false };

const run = (
  over: Partial<PropertyVsEtfInput> = {},
  tax: Partial<PropertyVsEtfTaxInput> = {},
  base: PropertyVsEtfInput = BASE_B,
) => simulatePropertyVsEtf({ ...base, ...over }, { ...TAX_ON, ...tax });

describe("Handrechnung C: BASE_B + Steuern, Horizont 2", () => {
  const r = run();
  it("Jahr 1", () => {
    const y = r.years[1]!;
    expect(y.taxableRentalIncomeYearCents).toBe(-4);
    expect(y.rentalIncomeTaxYearCents).toBe(-1);
    expect(y.cashflowBeforeTaxYearCents).toBe(-48_000);
    expect(y.cashflowYearCents).toBe(-47_999);
    expect(y.etfTopUpYearCents).toBe(47_999);
    expect(y.etfPaidInCents).toBe(2_047_999);
    expect(y.etfValueCents).toBe(2_047_999);
    expect(y.cumulativeDepreciationCents).toBe(352_000);
    expect(y.speculationGainCents).toBe(-1_648_000);
    expect(y.speculationTaxCents).toBe(0);
    expect(y.propertyLiquidationCents).toBe(399_996);
    expect(y.etfTaxCents).toBe(0);
    expect(y.advantageCents).toBe(-1_648_003);
  });
  it("Jahr 2", () => {
    const y = r.years[2]!;
    expect(y.rentalIncomeTaxYearCents).toBe(-1);
    expect(y.etfPaidInCents).toBe(2_095_998);
    expect(y.cumulativeDepreciationCents).toBe(704_000);
    expect(y.propertyLiquidationCents).toBe(799_992);
    expect(y.advantageCents).toBe(-1_296_006);
    expect(r.flags.hadRefunds).toBe(true);
    expect(r.depreciationBasisCents).toBe(17_600_000);
    expect(r.annualDepreciationCents).toBe(352_000);
    expect(r.speculationFreeFromYear).toBe(11);
  });
});

describe("Handrechnung D: steuerlicher Verlust mit Erstattung", () => {
  const over = { coldRentPerSqmCents: 500, vacancyBps: 0, monthlyHoaCostsCents: 0, horizonYears: 1 };
  it("Erstattung senkt Zuzahlung", () => {
    const r = run(over);
    const y = r.years[1]!;
    expect(y.rentalIncomeTaxYearCents).toBe(-75_601);
    expect(y.cashflowBeforeTaxYearCents).toBe(-300_000);
    expect(y.cashflowYearCents).toBe(-224_399);
    expect(y.etfTopUpYearCents).toBe(224_399);
    expect(y.etfPaidInCents).toBe(2_224_399);
    const off = run(over, { taxesEnabled: false });
    expect(off.years[1]!.etfTopUpYearCents).toBe(300_000);
    expect(300_000 - y.etfTopUpYearCents).toBe(75_601);
    expect(r.flags.hadRefunds).toBe(true);
  });
});

describe("Handrechnung E: Spekulationssteuer und Verkaufskosten", () => {
  it("Spekulationssteuer auf AfA-Gewinn", () => {
    const y = run({ valueGrowthBps: 1_000, horizonYears: 1 }).years[1]!;
    expect(y.propertyValueCents).toBe(22_000_000);
    expect(y.speculationGainCents).toBe(352_000);
    expect(y.speculationTaxCents).toBe(105_600);
    expect(y.propertyLiquidationCents).toBe(2_294_396);
  });
  it("Verkaufskosten 5 %", () => {
    const r = run({ valueGrowthBps: 1_000, horizonYears: 1 }, { saleCostsBps: 500 });
    const y = r.years[1]!;
    expect(y.saleCostsCents).toBe(1_100_000);
    expect(y.speculationTaxCents).toBe(0);
    expect(y.propertyLiquidationCents).toBe(1_299_996);
  });
});

describe("Grenzfälle", () => {
  it("Schalter aus: alle Steuer-/AfA-Felder 0", () => {
    const r = run({ horizonYears: 12 }, { taxesEnabled: false });
    expect(r.speculationFreeFromYear).toBeNull();
    expect(r.taxesEnabled).toBe(false);
    expect(r.depreciationBasisCents).toBe(0);
    expect(r.annualDepreciationCents).toBe(0);
    for (const y of r.years) {
      expect(y.depreciationYearCents).toBe(0);
      expect(y.cumulativeDepreciationCents).toBe(0);
      expect(y.rentalIncomeTaxYearCents).toBe(0);
      expect(y.taxableRentalIncomeYearCents).toBe(0);
      expect(y.speculationTaxCents).toBe(0);
      expect(y.etfTaxCents).toBe(0);
      expect(y.cashflowYearCents).toBe(y.cashflowBeforeTaxYearCents);
    }
    expect(r.initialMonthlyCashflowCents).toBe(r.initialMonthlyCashflowBeforeTaxCents);
  });

  it("Grenzsteuersatz 0 %: keine V+V-/Spekulationssteuer, AfA läuft, ETF-Steuer bleibt", () => {
    const r = run({ horizonYears: 12, valueGrowthBps: 500, etfAnnualReturnBps: 600 }, { marginalTaxRateBps: 0 }, BASE_A);
    for (const y of r.years) {
      expect(y.rentalIncomeTaxYearCents).toBe(0);
      expect(y.speculationTaxCents).toBe(0);
    }
    expect(r.years[1]!.depreciationYearCents).toBe(352_000);
    expect(r.years[12]!.etfTaxCents).toBeGreaterThan(0);
  });

  it("Gewinn → Steuer senkt Überschuss", () => {
    const over = { coldRentPerSqmCents: 3_000, equityCents: 22_000_000, horizonYears: 3 };
    const on = run(over, {}, BASE_A);
    const off = run(over, { taxesEnabled: false }, BASE_A);
    for (let i = 1; i <= 3; i += 1) {
      const a = on.years[i]!;
      const b = off.years[i]!;
      expect(a.rentalIncomeTaxYearCents).toBeGreaterThan(0);
      expect(b.surplusYearCents - a.surplusYearCents).toBe(a.rentalIncomeTaxYearCents);
    }
  });

  it("Verkauf genau an der Frist: Sprung in Jahr 11", () => {
    const r = run({ valueGrowthBps: 300, horizonYears: 12 }, {}, BASE_A);
    const y = r.years;
    expect(y[10]!.speculationTaxCents).toBeGreaterThan(0);
    expect(y[11]!.speculationTaxCents).toBe(0);
    const jump = y[11]!.propertyLiquidationCents - y[10]!.propertyLiquidationCents;
    const prev = y[10]!.propertyLiquidationCents - y[9]!.propertyLiquidationCents;
    expect(jump).toBeGreaterThan(prev);
    expect(r.flags.speculationTaxApplied).toBe(true);
  });

  it("Frist 0 und 40", () => {
    const zero = run({ valueGrowthBps: 500, horizonYears: 40 }, { speculationPeriodYears: 0 });
    expect(zero.years.slice(1).every((y) => y.speculationTaxCents === 0)).toBe(true);
    expect(zero.years[0]!.speculationTaxCents).toBe(0);
    const forty = run({ valueGrowthBps: 500, horizonYears: 40 }, { speculationPeriodYears: 40 });
    expect(forty.years[40]!.speculationTaxCents).toBeGreaterThan(0);
    expect(forty.speculationFreeFromYear).toBe(41);
  });

  it("Gewinn unter Sparerpauschbetrag: ETF-Steuer 0", () => {
    const r = run({ etfAnnualReturnBps: 100, horizonYears: 1 }, {}, BASE_A);
    expect(r.years[1]!.etfTaxCents).toBe(0);
    expect(r.years[1]!.etfLiquidationCents).toBe(r.years[1]!.etfValueCents);
  });

  it("Teilfreistellung 0 % / 100 %", () => {
    const over = { etfAnnualReturnBps: 600, horizonYears: 20 };
    const zero = run(over, { partialExemptionBps: 0 }, BASE_A);
    const def = run(over, {}, BASE_A);
    const full = run(over, { partialExemptionBps: 10_000 }, BASE_A);
    expect(zero.years[20]!.etfTaxCents).toBeGreaterThan(def.years[20]!.etfTaxCents);
    expect(full.years.every((y) => y.etfTaxCents === 0)).toBe(true);
  });

  it("Verkaufskosten hoch, auch bei Schalter aus; Jahr 0 darf negativ sein", () => {
    const r = run({ horizonYears: 3 }, { saleCostsBps: 2_000, taxesEnabled: false });
    for (const y of r.years) {
      expect(y.propertyValueCents).toBe(20_000_000);
      expect(y.saleCostsCents).toBe(4_000_000);
    }
    const y0 = r.years[0]!;
    expect(y0.propertyLiquidationCents).toBe(
      y0.propertyValueCents - y0.saleCostsCents - y0.remainingDebtCents,
    );
    expect(y0.propertyLiquidationCents).toBeLessThan(0);
    const lowCosts = run({ horizonYears: 12, valueGrowthBps: 500 }, { saleCostsBps: 0 });
    const highCosts = run({ horizonYears: 12, valueGrowthBps: 500 }, { saleCostsBps: 2_000 });
    expect(highCosts.years[5]!.speculationTaxCents).toBeLessThan(lowCosts.years[5]!.speculationTaxCents);
  });

  it("Jahr 0 mit Standardwerten", () => {
    const y0 = run({}, {}, BASE_A).years[0]!;
    expect(y0.speculationTaxCents).toBe(0);
    expect(y0.etfTaxCents).toBe(0);
    expect(y0.propertyLiquidationCents).toBe(y0.propertyValueCents - y0.saleCostsCents - y0.remainingDebtCents);
  });

  it("AfA-Deckel über den Horizont", () => {
    const r = run({ horizonYears: 40 }, { depreciationRateBps: 300 });
    expect(r.years[33]!.cumulativeDepreciationCents).toBe(17_424_000);
    expect(r.years[34]!.depreciationYearCents).toBe(176_000);
    for (let i = 35; i <= 40; i += 1) {
      expect(r.years[i]!.depreciationYearCents).toBe(0);
    }
    expect(r.years[40]!.cumulativeDepreciationCents).toBe(r.depreciationBasisCents);
  });

  it("AfA 10 % und Gebäudeanteil 100 %", () => {
    const r = run({ horizonYears: 12 }, { depreciationRateBps: 1_000, buildingShareBps: 10_000 });
    expect(r.years[10]!.cumulativeDepreciationCents).toBe(r.depreciationBasisCents);
    expect(r.years[11]!.depreciationYearCents).toBe(0);
    expect(r.years[12]!.depreciationYearCents).toBe(0);
  });

  it("Darlehen vorzeitig getilgt: Zinsen entfallen, Steuer steigt", () => {
    const r = run({ initialRepaymentBps: 1_000, interestRateBps: 300, horizonYears: 15 }, {}, BASE_A);
    expect(r.loanPaidOffInMonth).not.toBeNull();
    const last = r.years[15]!;
    expect(last.interestYearCents).toBe(0);
    expect(last.rentalIncomeTaxYearCents).toBeGreaterThan(0);
    expect(last.cashflowYearCents).toBeLessThan(last.cashflowBeforeTaxYearCents);

    const p = Math.ceil(r.loanPaidOffInMonth! / 12);
    expect(p + 1).toBeLessThanOrEqual(15);
    expect(r.years[p + 1]!.taxableRentalIncomeYearCents).toBeGreaterThan(
      r.years[p - 1]!.taxableRentalIncomeYearCents,
    );
    expect(r.years[p + 1]!.rentalIncomeTaxYearCents).toBeGreaterThan(
      r.years[p - 1]!.rentalIncomeTaxYearCents,
    );
  });
});

const maxInput: PropertyVsEtfInput = {
  purchasePriceCents: 10_000_000_000,
  livingAreaCentiSqm: 100_000,
  coldRentPerSqmCents: 10_000,
  purchaseCostsBps: 3_000,
  equityCents: 3_000_000_000,
  interestRateBps: 1_500,
  initialRepaymentBps: 1_000,
  rentGrowthBps: 1_000,
  valueGrowthBps: 1_000,
  costGrowthBps: 1_000,
  vacancyBps: 5_000,
  monthlyHoaCostsCents: 10_000_000,
  maintenanceReserveBps: 500,
  etfAnnualReturnBps: 3_000,
  horizonYears: 40,
};

const INPUTS: [string, PropertyVsEtfInput][] = [
  ["A40", { ...BASE_A, horizonYears: 40 }],
  ["B40", { ...BASE_B, horizonYears: 40 }],
  ["A40 Darlehen 0", { ...BASE_A, equityCents: 22_000_000, horizonYears: 40 }],
  ["A40 Miete 0", { ...BASE_A, coldRentPerSqmCents: 0, horizonYears: 40 }],
  ["A12 Wert fällt", { ...BASE_A, valueGrowthBps: -500, horizonYears: 12 }],
  [
    "Defaults 40",
    {
      purchasePriceCents: 20_000_000,
      livingAreaCentiSqm: 5000,
      coldRentPerSqmCents: 1000,
      equityCents: 4_000_000,
      ...PROPERTY_VS_ETF_DEFAULTS,
      horizonYears: 40,
    },
  ],
  ["max", maxInput],
  ["max Miete 0", { ...maxInput, coldRentPerSqmCents: 0 }],
];

describe("Regression gegen 25a", () => {
  it.each(INPUTS)("Schalter aus, 0 % Verkaufskosten = ohne tax (%s)", (_n, x) => {
    const r = simulatePropertyVsEtf(x, { ...TAX_OFF, saleCostsBps: 0 });
    expect(r).toEqual(simulatePropertyVsEtf(x));
    expect(
      r.years.every(
        (y) =>
          y.propertyLiquidationCents === y.propertyNetWorthCents &&
          y.etfLiquidationCents === y.etfValueCents,
      ),
    ).toBe(true);
    expect(r.final.propertyLiquidationCents).toBe(r.final.propertyNetWorthCents);
    expect(r.final.etfLiquidationCents).toBe(r.final.etfNetWorthCents);
  });

  const EXTREME: PropertyVsEtfTaxInput = {
    taxesEnabled: false,
    marginalTaxRateBps: 5_000,
    depreciationRateBps: 1_000,
    buildingShareBps: 10_000,
    speculationPeriodYears: 40,
    saverAllowanceCents: 0,
    partialExemptionBps: 0,
    churchTaxBps: 900,
    saleCostsBps: 0,
  };
  it.each(INPUTS)("Schalter aus ignoriert extreme Parameter (%s)", (_n, x) => {
    expect(simulatePropertyVsEtf(x, EXTREME)).toEqual(simulatePropertyVsEtf(x));
  });

  it("Verkaufskosten bei Schalter aus ändern nur Liquidationsfelder", () => {
    const x = { ...BASE_A, horizonYears: 10 };
    const base = simulatePropertyVsEtf(x);
    const costly = simulatePropertyVsEtf(x, { ...TAX_OFF, saleCostsBps: 500 });
    const liq = ["saleCostsCents", "propertyLiquidationCents", "advantageCents", "speculationGainCents"] as const;
    costly.years.forEach((row, i) => {
      const b = base.years[i]!;
      const strip = (o: object) =>
        Object.fromEntries(Object.entries(o).filter(([k]) => !(liq as readonly string[]).includes(k)));
      expect(strip(row)).toEqual(strip(b));
      expect(row.saleCostsCents).toBeGreaterThan(0);
    });
    expect(costly.years[10]!.propertyLiquidationCents).toBeLessThan(base.years[10]!.propertyLiquidationCents);

    // Ergebnisebene: nur years, final.advantageCents/-liquidation, breakEven, leadsAtHorizon dürfen abweichen.
    const { years: _ya, final: fa, breakEven: _ba, leadsAtHorizon: _la, ...restC } = costly;
    const { years: _yb, final: fb, breakEven: _bb, leadsAtHorizon: _lb, ...restB } = base;
    void [_ya, _ba, _la, _yb, _bb, _lb];
    expect(restC).toEqual(restB);
    expect(fa.etfLiquidationCents).toBe(fb.etfLiquidationCents);
    expect(fa.propertyNetWorthCents).toBe(fb.propertyNetWorthCents);
    expect(fa.etfNetWorthCents).toBe(fb.etfNetWorthCents);
  });
});

function checkInvariants(r: PropertyVsEtfResult, frist: number) {
  let prevCum = 0;
  r.years.forEach((y, i) => {
    expect(y.propertyLiquidationCents).toBe(
      y.propertyValueCents - y.saleCostsCents - y.speculationTaxCents - y.remainingDebtCents + y.accumulatedSurplusCents,
    );
    expect(y.etfLiquidationCents).toBe(y.etfValueCents - y.etfTaxCents);
    expect(y.advantageCents).toBe(y.propertyLiquidationCents - y.etfLiquidationCents);
    expect(y.cashflowYearCents).toBe(y.cashflowBeforeTaxYearCents - y.rentalIncomeTaxYearCents);
    if (i > 0) {
      expect(y.surplusYearCents - y.etfTopUpYearCents).toBe(y.cashflowYearCents);
    }
    expect(y.cumulativeDepreciationCents).toBeGreaterThanOrEqual(prevCum);
    expect(y.cumulativeDepreciationCents - prevCum).toBe(y.depreciationYearCents);
    expect(y.cumulativeDepreciationCents).toBeLessThanOrEqual(r.depreciationBasisCents);
    prevCum = y.cumulativeDepreciationCents;
    expect(y.speculationTaxCents).toBeGreaterThanOrEqual(0);
    expect(y.etfTaxCents).toBeGreaterThanOrEqual(0);
    expect(y.saleCostsCents).toBeGreaterThanOrEqual(0);
    if (i > frist) expect(y.speculationTaxCents).toBe(0);
    for (const v of Object.values(y)) expect(Number.isSafeInteger(v)).toBe(true);
  });
  const last = r.years[r.years.length - 1]!;
  expect(r.final.propertyLiquidationCents).toBe(last.propertyLiquidationCents);
  expect(r.final.etfLiquidationCents).toBe(last.etfLiquidationCents);
  expect(r.final.advantageCents).toBe(last.advantageCents);
  const first = r.years.find((y) => y.advantageCents >= 0);
  expect(r.breakEven).toEqual(first ? { kind: "year", year: first.year } : { kind: "never" });
  expect(r.leadsAtHorizon).toBe(last.advantageCents >= 0);
}

describe("Invarianten (Steuer an)", () => {
  it.each(INPUTS)("%s", (_n, x) => {
    checkInvariants(simulatePropertyVsEtf(x, { ...TAX_ON, saleCostsBps: 300 }), 10);
  });

  it("Frist 5, KiSt 9 %", () => {
    checkInvariants(
      simulatePropertyVsEtf({ ...BASE_A, horizonYears: 20 }, { ...TAX_ON, speculationPeriodYears: 5, churchTaxBps: 900 }),
      5,
    );
  });

  it("Maximalwerte: kein Überlauf", () => {
    const tax: PropertyVsEtfTaxInput = {
      taxesEnabled: true,
      marginalTaxRateBps: 5_000,
      depreciationRateBps: 1_000,
      buildingShareBps: 10_000,
      speculationPeriodYears: 40,
      saverAllowanceCents: 0,
      partialExemptionBps: 0,
      churchTaxBps: 900,
      saleCostsBps: 2_000,
    };
    for (const x of [maxInput, { ...maxInput, coldRentPerSqmCents: 0 }]) {
      let r!: PropertyVsEtfResult;
      expect(() => {
        r = simulatePropertyVsEtf(x, tax);
      }).not.toThrow();
      expect(r.years).toHaveLength(41);
      for (const y of r.years) {
        for (const v of Object.values(y)) expect(Number.isSafeInteger(v)).toBe(true);
      }
    }
  });

  it("deterministisch, ohne Mutation von input und tax", () => {
    const x = { ...BASE_A, horizonYears: 10 };
    const t = { ...TAX_ON };
    const xCopy = structuredClone(x);
    const tCopy = structuredClone(t);
    const a = simulatePropertyVsEtf(x, t);
    const b = simulatePropertyVsEtf(x, t);
    expect(a).toEqual(b);
    expect(x).toEqual(xCopy);
    expect(t).toEqual(tCopy);
  });

  it("ungültige Steuer-Eingabe wirft", () => {
    expect(() => simulatePropertyVsEtf(BASE_A, { ...TAX_ON, churchTaxBps: 500 })).toThrow(RangeError);
    expect(() =>
      simulatePropertyVsEtf(BASE_A, { ...TAX_ON, taxesEnabled: 1 as unknown as boolean }),
    ).toThrow(TypeError);
  });
});
