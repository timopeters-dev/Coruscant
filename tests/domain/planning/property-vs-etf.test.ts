import { describe, expect, it } from "vitest";
import { projectRemainingDebt } from "@/domain/planning/purchase";
import {
  simulatePropertyVsEtf,
  validatePropertyVsEtfInput,
  type PropertyVsEtfInput,
} from "@/domain/planning/property-vs-etf";
import { calculatePurchaseCostsCents } from "@/domain/planning/property-vs-etf-defaults";
import { applyMonthlyGrowth, computeMonthlyGrowthFactor } from "@/domain/planning/etf";

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

const sim = (over: Partial<PropertyVsEtfInput> = {}) =>
  simulatePropertyVsEtf({ ...BASE_A, ...over });

describe("Handrechnung A (Zinsen, Rendite, Steigerungen)", () => {
  const r = sim();

  it("Ausgangsgrößen", () => {
    expect(r.purchaseCostsCents).toBe(2_000_000);
    expect(r.totalCostCents).toBe(22_000_000);
    expect(r.loanPrincipalCents).toBe(20_000_000);
    expect(r.monthlyLoanRateCents).toBe(83_333);
    expect(r.initialMonthlyColdRentCents).toBe(50_000);
    expect(r.initialMonthlyCashflowCents).toBe(-54_000);
    expect(computeMonthlyGrowthFactor(600)).toBe(1_004_867_550_565n);
    expect(applyMonthlyGrowth(2_000_000, computeMonthlyGrowthFactor(600))).toBe(2_009_735);
  });

  it("Jahr 0", () => {
    expect(r.years[0]).toMatchObject({
      year: 0,
      propertyValueCents: 20_000_000,
      remainingDebtCents: 20_000_000,
      propertyNetWorthCents: 0,
      etfValueCents: 2_000_000,
      etfPaidInCents: 2_000_000,
      advantageCents: -2_000_000,
      cashflowYearCents: 0,
    });
  });

  it("Jahr 1", () => {
    expect(r.years[1]).toMatchObject({
      propertyValueCents: 20_400_000,
      remainingDebtCents: 19_594_456,
      propertyNetWorthCents: 805_544,
      etfValueCents: 2_785_631,
      etfPaidInCents: 2_648_000,
      advantageCents: -1_980_087,
      interestYearCents: 594_452,
      principalYearCents: 405_544,
      cashflowYearCents: -648_000,
      monthlyColdRentCents: 50_000,
      maintenanceReserveYearCents: 16_667 * 12,
      hoaCostsYearCents: 3_000 * 12,
    });
  });

  it("Jahr 2", () => {
    expect(r.years[2]).toMatchObject({
      propertyValueCents: 20_808_000,
      remainingDebtCents: 19_176_580,
      propertyNetWorthCents: 1_631_420,
      etfValueCents: 3_611_166,
      etfPaidInCents: 3_288_956,
      advantageCents: -1_979_746,
      interestYearCents: 582_120,
      principalYearCents: 417_876,
      cashflowYearCents: -640_956,
      monthlyColdRentCents: 51_000,
      hoaCostsYearCents: 3_060 * 12,
      maintenanceReserveYearCents: 17_000 * 12,
    });
  });

  it("kein Break-even, Überschuss 0", () => {
    expect(r.breakEven).toEqual({ kind: "never" });
    expect(r.leadsAtHorizon).toBe(false);
    expect(r.flags.hadTopUps).toBe(true);
    expect(r.flags.hadSurplus).toBe(false);
    expect(r.years.every((y) => y.accumulatedSurplusCents === 0)).toBe(true);
    expect(r.years[1]!.etfTopUpYearCents).toBe(648_000);
    expect(r.final).toMatchObject({
      propertyNetWorthCents: 1_631_420,
      etfNetWorthCents: 3_611_166,
      advantageCents: -1_979_746,
    });
  });
});

describe("Handrechnung B (alle Raten 0)", () => {
  const r = simulatePropertyVsEtf(BASE_B);

  it("Rate und Cashflow", () => {
    expect(r.monthlyLoanRateCents).toBe(33_333);
    expect(r.initialMonthlyCashflowCents).toBe(-4_000);
    expect(r.years[1]!.cashflowYearCents).toBe(-48_000);
  });

  it("Jahreszeilen", () => {
    expect(r.years[1]).toMatchObject({
      remainingDebtCents: 19_600_004,
      propertyNetWorthCents: 399_996,
      etfValueCents: 2_048_000,
      etfPaidInCents: 2_048_000,
      advantageCents: -1_648_004,
    });
    expect(r.years[2]).toMatchObject({
      remainingDebtCents: 19_200_008,
      propertyNetWorthCents: 799_992,
      etfValueCents: 2_096_000,
      etfPaidInCents: 2_096_000,
      advantageCents: -1_296_008,
    });
  });
});

describe("Grenzfälle", () => {
  it("Zins 0 %: Restschuld sinkt linear", () => {
    const r = simulatePropertyVsEtf({ ...BASE_A, interestRateBps: 0, initialRepaymentBps: 200 });
    expect(r.years.every((y) => y.interestYearCents === 0)).toBe(true);
    expect(r.years[1]!.remainingDebtCents).toBe(20_000_000 - 12 * r.monthlyLoanRateCents);
    expect(r.years[2]!.remainingDebtCents).toBe(20_000_000 - 24 * r.monthlyLoanRateCents);
  });

  it("Tilgung 0 %: Restschuld konstant", () => {
    const r = sim({ interestRateBps: 380, initialRepaymentBps: 0 });
    expect(r.flags.noAmortization).toBe(true);
    expect(r.years.every((y) => y.remainingDebtCents === 20_000_000)).toBe(true);
    expect(r.years.every((y) => y.principalYearCents === 0)).toBe(true);
    expect(r.monthlyLoanRateCents).toBe(63_333);
  });

  it("Zins und Tilgung 0 %: Rate 0", () => {
    const r = sim({ interestRateBps: 0, initialRepaymentBps: 0 });
    expect(r.monthlyLoanRateCents).toBe(0);
    expect(r.years.every((y) => y.remainingDebtCents === 20_000_000)).toBe(true);
    expect(r.initialMonthlyCashflowCents).toBe(50_000 - 1_000 - 3_000 - 16_667);
    expect(r.flags.noAmortization).toBe(true);
  });

  it("positiver Cashflow (Darlehen 0)", () => {
    const r = sim({ equityCents: 22_000_000, horizonYears: 1 });
    expect(r.flags.noLoan).toBe(true);
    expect(r.flags.noAmortization).toBe(false);
    expect(r.loanPaidOffInMonth).toBeNull();
    expect(r.initialMonthlyCashflowCents).toBe(29_333);
    expect(r.years[1]!.accumulatedSurplusCents).toBe(351_996);
    expect(r.years[1]!.etfTopUpYearCents).toBe(0);
    expect(r.years[1]!.etfPaidInCents).toBe(22_000_000);
    let etf = 22_000_000;
    const f = computeMonthlyGrowthFactor(600);
    for (let i = 0; i < 12; i += 1) etf = applyMonthlyGrowth(etf, f);
    expect(r.years[1]!.etfValueCents).toBe(etf);
    expect(r.flags.hadSurplus).toBe(true);
    expect(r.flags.hadTopUps).toBe(false);
  });

  it("Vorzeichenwechsel des Cashflows", () => {
    const r = sim({
      coldRentPerSqmCents: 2000,
      vacancyBps: 0,
      costGrowthBps: 0,
      valueGrowthBps: 0,
      rentGrowthBps: 1000,
      horizonYears: 3,
    });
    expect(r.years[1]!.etfTopUpYearCents).toBeGreaterThan(0);
    expect(r.years[2]!.surplusYearCents).toBeGreaterThan(0);
    expect(r.flags.hadTopUps && r.flags.hadSurplus).toBe(true);
  });

  it("Horizont 1", () => {
    const r = sim({ horizonYears: 1 });
    expect(r.years).toHaveLength(2);
    expect(r.final.propertyNetWorthCents).toBe(r.years[1]!.propertyNetWorthCents);
  });

  it("Horizont 40 mit Standardwerten", () => {
    const r = sim({ horizonYears: 40 });
    expect(r.years).toHaveLength(41);
    expect(r.years.map((y) => y.year)).toEqual(Array.from({ length: 41 }, (_, i) => i));
    for (const row of r.years) {
      for (const v of Object.values(row)) expect(Number.isSafeInteger(v)).toBe(true);
    }
  });

  it("Darlehen vorzeitig getilgt", () => {
    const input: PropertyVsEtfInput = {
      ...BASE_A,
      purchaseCostsBps: 0,
      equityCents: 0,
      interestRateBps: 100,
      initialRepaymentBps: 1000,
      horizonYears: 15,
    };
    const r = simulatePropertyVsEtf(input);
    const ref = projectRemainingDebt(r.loanPrincipalCents, 100, r.monthlyLoanRateCents, 180);
    expect(ref.paidOffInMonth).not.toBeNull();
    expect(r.loanPaidOffInMonth).toBe(ref.paidOffInMonth);
    expect(r.flags.loanPaidOffWithinHorizon).toBe(true);
    const payoffYear = Math.ceil(r.loanPaidOffInMonth! / 12);
    for (const row of r.years.slice(payoffYear + 1)) {
      expect(row.remainingDebtCents).toBe(0);
      expect(row.interestYearCents).toBe(0);
      expect(row.principalYearCents).toBe(0);
    }
    expect(r.years[payoffYear + 1]!.cashflowYearCents).toBeGreaterThan(
      r.years[payoffYear - 1]!.cashflowYearCents,
    );
  });

  it("Eigenkapital-Grenzen", () => {
    expect(() => sim({ equityCents: 1_999_999 })).toThrow(/cover purchase costs/);
    expect(() => sim({ equityCents: 2_000_000 })).not.toThrow();
    expect(() => sim({ equityCents: 22_000_000 })).not.toThrow();
    expect(() => sim({ equityCents: 22_000_001 })).toThrow(/exceed total cost/);
    expect(sim({ equityCents: 22_000_000 }).loanPrincipalCents).toBe(0);
  });

  it("Kaltmiete 0", () => {
    const r = sim({ coldRentPerSqmCents: 0 });
    expect(r.initialMonthlyColdRentCents).toBe(0);
    expect(r.years[1]!.vacancyYearCents).toBe(0);
    expect(r.initialMonthlyCashflowCents).toBe(-(3_000 + 16_667 + 83_333));
    expect(r.breakEven).toEqual({ kind: "never" });
  });

  it("Break-even Jahr 0 und Gleichstand", () => {
    const r = sim({ purchaseCostsBps: 0, equityCents: 0 });
    expect(r.years[0]!.advantageCents).toBe(0);
    expect(r.breakEven).toEqual({ kind: "year", year: 0 });
  });

  it("Break-even später", () => {
    const r = sim({
      livingAreaCentiSqm: 10_000,
      coldRentPerSqmCents: 4000,
      etfAnnualReturnBps: 0,
      horizonYears: 5,
    });
    expect(r.breakEven.kind).toBe("year");
    if (r.breakEven.kind === "year") {
      const y = r.breakEven.year;
      expect(y).toBeGreaterThan(0);
      expect(r.years[y]!.advantageCents).toBeGreaterThanOrEqual(0);
      expect(r.years[y - 1]!.advantageCents).toBeLessThan(0);
    }
    expect(r.leadsAtHorizon).toBe(true);
  });
});

describe("Festlegungen und Invarianten", () => {
  it("Rücklage wächst mit dem Wert", () => {
    const grow = sim({ valueGrowthBps: 200 });
    expect(grow.years[2]!.maintenanceReserveYearCents / 12).toBe(
      Math.round((grow.years[1]!.propertyValueCents * 100) / 120_000),
    );
    expect(grow.years[2]!.maintenanceReserveYearCents).toBeGreaterThan(
      grow.years[1]!.maintenanceReserveYearCents,
    );
    const flat = sim({ valueGrowthBps: 0 });
    expect(flat.years[2]!.maintenanceReserveYearCents).toBe(
      flat.years[1]!.maintenanceReserveYearCents,
    );
    const shrink = sim({ valueGrowthBps: -500 });
    expect(shrink.years[2]!.maintenanceReserveYearCents).toBeLessThan(
      shrink.years[1]!.maintenanceReserveYearCents,
    );
  });

  it("Kostensteigerung wirkt nur auf WEG", () => {
    const a = sim({ costGrowthBps: 0, horizonYears: 5 });
    const b = sim({ costGrowthBps: 1000, horizonYears: 5 });
    for (let i = 0; i <= 5; i += 1) {
      const x = a.years[i]!;
      const y = b.years[i]!;
      expect(y.monthlyColdRentCents).toBe(x.monthlyColdRentCents);
      expect(y.vacancyYearCents).toBe(x.vacancyYearCents);
      expect(y.maintenanceReserveYearCents).toBe(x.maintenanceReserveYearCents);
      expect(y.interestYearCents).toBe(x.interestYearCents);
      expect(y.propertyValueCents).toBe(x.propertyValueCents);
    }
    expect(b.years[3]!.hoaCostsYearCents).toBeGreaterThan(a.years[3]!.hoaCostsYearCents);
  });

  it("Mietsteigerung iterativ, Jahr 1 = Ausgangsmiete", () => {
    const r = sim({ horizonYears: 3, rentGrowthBps: 250 });
    expect(r.years[1]!.monthlyColdRentCents).toBe(50_000);
    expect(r.years[2]!.monthlyColdRentCents).toBe(51_250);
    expect(r.years[3]!.monthlyColdRentCents).toBe(52_531); // 52.531,25 → half-up
  });

  it("ETF exakt", () => {
    const zero = sim({ etfAnnualReturnBps: 0 });
    for (const row of zero.years) expect(row.etfValueCents).toBe(row.etfPaidInCents);
    const neg = sim({ etfAnnualReturnBps: -5000, horizonYears: 5 });
    for (const row of neg.years) expect(row.etfValueCents).toBeGreaterThanOrEqual(0);
    const noTopUp = sim({ equityCents: 22_000_000, etfAnnualReturnBps: -5000 });
    expect(noTopUp.years[1]!.etfValueCents).toBeLessThan(22_000_000);
  });

  it("Invarianten je Zeile", () => {
    const r = sim({ horizonYears: 25, rentGrowthBps: 300, valueGrowthBps: -100 });
    r.years.forEach((row, i) => {
      expect(row.propertyNetWorthCents).toBe(
        row.propertyValueCents - row.remainingDebtCents + row.accumulatedSurplusCents,
      );
      expect(row.advantageCents).toBe(row.propertyNetWorthCents - row.etfValueCents);
      expect(row.cashflowYearCents).toBe(row.surplusYearCents - row.etfTopUpYearCents);
      expect(row.remainingDebtCents).toBeGreaterThanOrEqual(0);
      expect(row.etfValueCents).toBeGreaterThanOrEqual(0);
      for (const v of Object.values(row)) expect(Number.isSafeInteger(v)).toBe(true);
      if (i > 0) {
        const prev = r.years[i - 1]!;
        expect(row.principalYearCents).toBe(prev.remainingDebtCents - row.remainingDebtCents);
        expect(row.etfPaidInCents - prev.etfPaidInCents).toBe(row.etfTopUpYearCents);
      }
    });
  });

  describe("Maximalwerte: kein stiller Überlauf", () => {
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
    for (const [name, input] of [
      ["alle Werte am Maximum", maxInput],
      ["Miete 0 (maximale Zuzahlungen)", { ...maxInput, coldRentPerSqmCents: 0 }],
    ] as const) {
      it(name, () => {
        expect(() => simulatePropertyVsEtf(input)).not.toThrow();
        const r = simulatePropertyVsEtf(input);
        expect(r.years).toHaveLength(41);
        for (const row of r.years) {
          for (const v of Object.values(row)) expect(Number.isSafeInteger(v)).toBe(true);
        }
      });
    }
  });

  it("deterministisch, ohne Mutation der Eingabe", () => {
    const input = { ...BASE_A };
    const copy = { ...input };
    expect(simulatePropertyVsEtf(input)).toEqual(simulatePropertyVsEtf(input));
    expect(input).toEqual(copy);
  });
});

describe("Ungültige Eingaben", () => {
  const bad = (over: Partial<PropertyVsEtfInput>) => () =>
    validatePropertyVsEtfInput({ ...BASE_A, ...over });

  it("wirft RangeError", () => {
    expect(bad({ purchasePriceCents: 12.5 })).toThrow(RangeError);
    expect(bad({ purchasePriceCents: Number.NaN })).toThrow(RangeError);
    expect(bad({ purchasePriceCents: Number.POSITIVE_INFINITY })).toThrow(RangeError);
    expect(bad({ monthlyHoaCostsCents: -1 })).toThrow(RangeError);
    expect(bad({ horizonYears: 0 })).toThrow(RangeError);
    expect(bad({ horizonYears: 41 })).toThrow(RangeError);
    expect(bad({ livingAreaCentiSqm: 0 })).toThrow(RangeError);
    expect(bad({ purchasePriceCents: 0 })).toThrow(RangeError);
    expect(bad({ vacancyBps: 5_001 })).toThrow(RangeError);
    expect(bad({ rentGrowthBps: -1_001 })).toThrow(RangeError);
    expect(bad({ etfAnnualReturnBps: 3_001 })).toThrow(RangeError);
  });

  it("Nebenkosten-Rundung konsistent mit Validierung", () => {
    expect(calculatePurchaseCostsCents(20_000_000, 1000)).toBe(2_000_000);
  });
});
