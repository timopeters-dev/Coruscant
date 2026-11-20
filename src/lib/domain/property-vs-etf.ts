import { calculateMonthlyInterestCents } from "./contracts";
import {
  assertNonNegativeInteger,
  assertSafeInteger,
  roundHalfUpBigInt,
} from "./money";
import { calculateLoanMonthlyRateCents } from "./property-purchase";
import { calculatePurchaseCostsCents } from "./property-vs-etf-defaults";
import {
  calculateAnnualDepreciationCents,
  calculateDepreciationBasisCents,
  calculateEtfLiquidation,
  calculatePropertySale,
  reserveDeductionForYearCents,
  calculateRentalIncomeTaxCents,
  depreciationForMonthCents,
  validatePropertyVsEtfTaxInput,
  type PropertyVsEtfTaxInput,
} from "./property-vs-etf-tax";
import {
  PROPERTY_VS_ETF_LIMITS,
  PROPERTY_VS_ETF_TAX_DEFAULTS,
} from "./property-vs-etf-defaults";
import { applyMonthlyGrowth, computeMonthlyGrowthFactor } from "./scenarios";

export interface PropertyVsEtfInput {
  purchasePriceCents: number;
  livingAreaCentiSqm: number;
  coldRentPerSqmCents: number;
  purchaseCostsBps: number;
  equityCents: number;
  interestRateBps: number;
  initialRepaymentBps: number;
  rentGrowthBps: number;
  valueGrowthBps: number;
  /** Wirkt nur auf `monthlyHoaCostsCents`. */
  costGrowthBps: number;
  /** Anteil der Kaltmiete. */
  vacancyBps: number;
  /** Nicht umlagefähige WEG-Kosten pro Monat. */
  monthlyHoaCostsCents: number;
  /** % p.a. vom jeweiligen Immobilienwert. */
  maintenanceReserveBps: number;
  etfAnnualReturnBps: number;
  horizonYears: number;
  /**
   * Positiven Monats-Cashflow in ein Überschuss-Depot auf der Immobilien-Seite
   * anlegen; `undefined` = `false`.
   */
  reinvestSurplus?: boolean;
}

export interface PropertyVsEtfYear {
  year: number;
  propertyValueCents: number;
  remainingDebtCents: number;
  accumulatedSurplusCents: number;
  propertyNetWorthCents: number;
  etfValueCents: number;
  etfPaidInCents: number;
  /**
   * Liquidationsvorteil: `propertyLiquidationCents − etfLiquidationCents`
   * (seit 25b nach Verkaufskosten und Steuern; ohne Steuern/Kosten wie 25a).
   */
  advantageCents: number;
  monthlyColdRentCents: number;
  coldRentYearCents: number;
  vacancyYearCents: number;
  hoaCostsYearCents: number;
  maintenanceReserveYearCents: number;
  interestYearCents: number;
  principalYearCents: number;
  cashflowYearCents: number;
  etfTopUpYearCents: number;
  surplusYearCents: number;
  /** Cashflow vor Einkommensteuer (= 25a-`cashflowYearCents`). */
  cashflowBeforeTaxYearCents: number;
  depreciationYearCents: number;
  cumulativeDepreciationCents: number;
  /** Vorzeichenbehaftet. */
  taxableRentalIncomeYearCents: number;
  /** Vorzeichenbehaftet, < 0 = Erstattung. */
  rentalIncomeTaxYearCents: number;
  saleCostsCents: number;
  /** Vorzeichenbehaftet, rein informativ. */
  speculationGainCents: number;
  speculationTaxCents: number;
  /** Erlös bei Verkauf am Jahresende (kann negativ sein). */
  propertyLiquidationCents: number;
  etfTaxCents: number;
  etfLiquidationCents: number;
  /** In diesem Jahr abgezogene Rücklage (Summe der Monate); 0 bei Steuern aus. */
  reserveDeductionYearCents: number;
  /** Depotwert am Jahresende vor Steuer; 0 bei Schalter aus. */
  surplusDepotValueCents: number;
  /** Kumulierte Einzahlungen ins Depot; 0 bei Schalter aus. */
  surplusDepotPaidInCents: number;
  /** ETF-Steuer auf das Depot bei Verkauf am Jahresende. */
  surplusDepotTaxCents: number;
  /** `surplusDepotValueCents − surplusDepotTaxCents`. */
  surplusDepotNetCents: number;
  /** Immobilien-Liquidation mit zinslos angesammeltem Überschuss (25d-Formel). */
  propertyLiquidationWithoutDepotCents: number;
}

export type PropertyVsEtfBreakEven =
  | { kind: "year"; year: number }
  | { kind: "never" };

export interface PropertyVsEtfResult {
  purchaseCostsCents: number;
  totalCostCents: number;
  loanPrincipalCents: number;
  monthlyLoanRateCents: number;
  initialMonthlyColdRentCents: number;
  /** Nach Einkommensteuer. */
  initialMonthlyCashflowCents: number;
  initialMonthlyCashflowBeforeTaxCents: number;
  taxesEnabled: boolean;
  reinvestSurplus: boolean;
  /** 0 bei Steuern aus. */
  reserveDeductionLagYears: number;
  depreciationBasisCents: number;
  annualDepreciationCents: number;
  /** `Frist + 1` bei aktiven Steuern, sonst `null`. */
  speculationFreeFromYear: number | null;
  loanPaidOffInMonth: number | null;
  years: PropertyVsEtfYear[];
  final: {
    propertyNetWorthCents: number;
    etfNetWorthCents: number;
    propertyLiquidationCents: number;
    etfLiquidationCents: number;
    /** Bezieht sich auf die Liquidationswerte. */
    advantageCents: number;
    propertyLiquidationWithoutDepotCents: number;
    surplusDepotValueCents: number;
    surplusDepotPaidInCents: number;
    surplusDepotTaxCents: number;
    surplusDepotNetCents: number;
  };
  breakEven: PropertyVsEtfBreakEven;
  leadsAtHorizon: boolean;
  flags: {
    noLoan: boolean;
    noAmortization: boolean;
    loanPaidOffWithinHorizon: boolean;
    hadTopUps: boolean;
    hadSurplus: boolean;
    hadRefunds: boolean;
    speculationTaxApplied: boolean;
    /** Steuern an, Verzögerung > 0 und gezahlte Rücklage wurde nie abgesetzt. */
    reserveDeductionDeferred: boolean;
  };
}

const FIELD_KEYS = [
  "purchasePriceCents",
  "livingAreaCentiSqm",
  "coldRentPerSqmCents",
  "purchaseCostsBps",
  "equityCents",
  "interestRateBps",
  "initialRepaymentBps",
  "rentGrowthBps",
  "valueGrowthBps",
  "costGrowthBps",
  "vacancyBps",
  "monthlyHoaCostsCents",
  "maintenanceReserveBps",
  "etfAnnualReturnBps",
  "horizonYears",
] as const satisfies readonly (keyof PropertyVsEtfInput)[];

export function validatePropertyVsEtfInput(input: PropertyVsEtfInput): void {
  for (const key of FIELD_KEYS) {
    const { min, max } = PROPERTY_VS_ETF_LIMITS[key];
    const value = assertSafeInteger(input[key], key);
    if (value < min || value > max) {
      throw new RangeError(
        `${key} must be between ${min} and ${max}, received: ${value}`,
      );
    }
  }
  if (
    input.reinvestSurplus !== undefined &&
    typeof input.reinvestSurplus !== "boolean"
  ) {
    throw new TypeError(
      `reinvestSurplus must be a boolean, received: ${String(input.reinvestSurplus)}`,
    );
  }

  const purchaseCosts = calculatePurchaseCostsCents(
    input.purchasePriceCents,
    input.purchaseCostsBps,
  );
  const totalCost = input.purchasePriceCents + purchaseCosts;
  if (input.equityCents < purchaseCosts) {
    throw new RangeError(
      `equityCents must cover purchase costs (${purchaseCosts}), received: ${input.equityCents}`,
    );
  }
  if (input.equityCents > totalCost) {
    throw new RangeError(
      `equityCents must not exceed total cost (${totalCost}), received: ${input.equityCents}`,
    );
  }
}

/** x × (10_000 + g) / 10_000, half-up. Erfordert x ≥ 0 und 10_000 + g > 0. */
function stepByBps(valueCents: number, growthBps: number): number {
  const value = assertNonNegativeInteger(valueCents, "valueCents");
  const rounded = roundHalfUpBigInt(
    BigInt(value) * BigInt(10_000 + growthBps),
    10_000n,
  );
  return assertSafeInteger(Number(rounded), "steppedValueCents");
}

/** base × bps / 120_000 (Jahresprozent, monatlicher Anteil), half-up. */
function monthlyShareOfAnnualBps(baseCents: number, bps: number): number {
  const base = assertNonNegativeInteger(baseCents, "baseCents");
  const rounded = roundHalfUpBigInt(BigInt(base) * BigInt(bps), 120_000n);
  return assertSafeInteger(Number(rounded), "monthlyShareCents");
}

function shareOfBps(baseCents: number, bps: number): number {
  const rounded = roundHalfUpBigInt(BigInt(baseCents) * BigInt(bps), 10_000n);
  return assertSafeInteger(Number(rounded), "shareCents");
}

/** Ohne `tax`: keine Steuern, keine Verkaufskosten (Verhalten von 25a). */
const NEUTRAL_TAX: PropertyVsEtfTaxInput = {
  ...PROPERTY_VS_ETF_TAX_DEFAULTS,
  taxesEnabled: false,
  brokerFeeBps: 0,
  otherSaleCostsBps: 0,
  reserveDeductionLagYears: 0,
};

/**
 * Simuliert Immobilie vs. ETF. Ohne `tax` rechnet der Kern steuerfrei wie 25a;
 * die Produkt-Defaults (`PROPERTY_VS_ETF_TAX_DEFAULTS`, Schalter an) übergibt
 * die UI explizit. `advantageCents`/`breakEven`/`final.advantageCents` beziehen
 * sich auf die Liquidationswerte (Verkauf am Jahresende).
 */
export function simulatePropertyVsEtf(
  input: PropertyVsEtfInput,
  tax?: PropertyVsEtfTaxInput,
): PropertyVsEtfResult {
  if (tax) {
    validatePropertyVsEtfTaxInput(tax);
  }
  validatePropertyVsEtfInput(input);
  const t = tax ?? NEUTRAL_TAX;
  const reinvest = input.reinvestSurplus === true;

  const purchaseCostsCents = calculatePurchaseCostsCents(
    input.purchasePriceCents,
    input.purchaseCostsBps,
  );
  const totalCostCents = assertSafeInteger(
    input.purchasePriceCents + purchaseCostsCents,
    "totalCostCents",
  );
  const loanPrincipalCents = totalCostCents - input.equityCents;
  const monthlyLoanRateCents = calculateLoanMonthlyRateCents(
    loanPrincipalCents,
    input.interestRateBps,
    input.initialRepaymentBps,
  );
  const factor = computeMonthlyGrowthFactor(input.etfAnnualReturnBps);
  const depreciationBasisCents = t.taxesEnabled
    ? calculateDepreciationBasisCents(totalCostCents, t.buildingShareBps)
    : 0;
  const annualDepreciationCents = t.taxesEnabled
    ? calculateAnnualDepreciationCents(
        depreciationBasisCents,
        t.depreciationRateBps,
      )
    : 0;
  let cumulativeDepreciation = 0;
  let hadRefunds = false;
  let speculationTaxApplied = false;
  let initialMonthlyCashflowBeforeTaxCents = 0;

  const liquidationFields = (
    yearsHeld: number,
    propertyValueCents: number,
    debtCents: number,
    surplusCents: number,
    etfValueCents: number,
    paidInCents: number,
    depotValueCents: number,
    depotPaidInCents: number,
  ) => {
    const sale = calculatePropertySale({
      valueCents: propertyValueCents,
      totalCostCents,
      cumulativeDepreciationCents: cumulativeDepreciation,
      yearsHeld,
      tax: t,
    });
    const etfLiq = calculateEtfLiquidation({
      valueCents: etfValueCents,
      paidInCents,
      tax: t,
    });
    const depotLiq = reinvest
      ? calculateEtfLiquidation({
          valueCents: depotValueCents,
          paidInCents: depotPaidInCents,
          tax: t,
        })
      : { etfTaxCents: 0, etfLiquidationCents: 0 };
    const propertyBase =
      propertyValueCents -
      sale.saleCostsCents -
      sale.speculationTaxCents -
      debtCents;
    const propertyLiquidationWithoutDepotCents = assertSafeInteger(
      propertyBase + surplusCents,
      "propertyLiquidationWithoutDepotCents",
    );
    const propertyLiquidationCents = reinvest
      ? assertSafeInteger(
          propertyBase + depotLiq.etfLiquidationCents,
          "propertyLiquidationCents",
        )
      : propertyLiquidationWithoutDepotCents;
    if (sale.speculationTaxCents > 0) {
      speculationTaxApplied = true;
    }
    return {
      saleCostsCents: sale.saleCostsCents,
      speculationGainCents: sale.speculationGainCents,
      speculationTaxCents: sale.speculationTaxCents,
      propertyLiquidationCents,
      etfTaxCents: etfLiq.etfTaxCents,
      etfLiquidationCents: etfLiq.etfLiquidationCents,
      propertyLiquidationWithoutDepotCents,
      surplusDepotValueCents: reinvest ? depotValueCents : 0,
      surplusDepotPaidInCents: reinvest ? depotPaidInCents : 0,
      surplusDepotTaxCents: depotLiq.etfTaxCents,
      surplusDepotNetCents: reinvest ? depotLiq.etfLiquidationCents : 0,
      advantageCents: assertSafeInteger(
        propertyLiquidationCents - etfLiq.etfLiquidationCents,
        "advantageCents",
      ),
    };
  };

  const initialRent = assertSafeInteger(
    Number(
      roundHalfUpBigInt(
        BigInt(input.livingAreaCentiSqm) * BigInt(input.coldRentPerSqmCents),
        100n,
      ),
    ),
    "initialMonthlyColdRentCents",
  );

  let rent = initialRent;
  let hoa = input.monthlyHoaCostsCents;
  let value = input.purchasePriceCents;
  let debt = loanPrincipalCents;
  let etf = input.equityCents;
  let paidIn = input.equityCents;
  let surplus = 0;
  let depot = 0;
  let depotPaidIn = 0;
  const reserveByYear: number[] = [0];
  let loanPaidOffInMonth: number | null = null;
  let monthCounter = 0;
  let initialMonthlyCashflowCents = 0;
  let hadTopUps = false;
  let hadSurplus = false;

  const years: PropertyVsEtfYear[] = [];
  const row0NetWorth = value - debt;
  const liq0 = liquidationFields(0, value, debt, 0, etf, paidIn, 0, 0);
  years.push({
    year: 0,
    propertyValueCents: value,
    remainingDebtCents: debt,
    accumulatedSurplusCents: 0,
    propertyNetWorthCents: row0NetWorth,
    etfValueCents: etf,
    etfPaidInCents: paidIn,
    ...liq0,
    monthlyColdRentCents: 0,
    coldRentYearCents: 0,
    vacancyYearCents: 0,
    hoaCostsYearCents: 0,
    maintenanceReserveYearCents: 0,
    interestYearCents: 0,
    principalYearCents: 0,
    cashflowYearCents: 0,
    etfTopUpYearCents: 0,
    surplusYearCents: 0,
    cashflowBeforeTaxYearCents: 0,
    depreciationYearCents: 0,
    cumulativeDepreciationCents: 0,
    taxableRentalIncomeYearCents: 0,
    rentalIncomeTaxYearCents: 0,
    reserveDeductionYearCents: 0,
  });

  for (let y = 1; y <= input.horizonYears; y += 1) {
    if (y >= 2) {
      rent = stepByBps(rent, input.rentGrowthBps);
      hoa = stepByBps(hoa, input.costGrowthBps);
    }
    const vacancy = shareOfBps(rent, input.vacancyBps);
    const reserve = monthlyShareOfAnnualBps(value, input.maintenanceReserveBps);
    reserveByYear[y] = reserve;
    const deductibleReserve = t.taxesEnabled
      ? reserveDeductionForYearCents(reserveByYear, y, t.reserveDeductionLagYears)
      : 0;
    const debtStart = debt;

    let interestYear = 0;
    let cashflowYear = 0;
    let cashflowBeforeTaxYear = 0;
    let depreciationYear = 0;
    let taxableYear = 0;
    let incomeTaxYear = 0;
    let topUpYear = 0;
    let surplusYear = 0;
    let reserveDeductionYear = 0;

    for (let m = 1; m <= 12; m += 1) {
      monthCounter += 1;
      const interest = calculateMonthlyInterestCents(debt, input.interestRateBps);
      const payment = Math.min(monthlyLoanRateCents, debt + interest);
      debt = debt + interest - payment;
      if (loanPrincipalCents > 0 && debt === 0 && loanPaidOffInMonth === null) {
        loanPaidOffInMonth = monthCounter;
      }
      interestYear += interest;

      const cfBeforeTax = rent - vacancy - hoa - reserve - payment;
      let afa = 0;
      let taxable = 0;
      let incomeTax = 0;
      if (t.taxesEnabled) {
        afa = depreciationForMonthCents(
          annualDepreciationCents,
          m,
          depreciationBasisCents - cumulativeDepreciation,
        );
        cumulativeDepreciation += afa;
        taxable = rent - vacancy - hoa - deductibleReserve - interest - afa;
        reserveDeductionYear += deductibleReserve;
        incomeTax = calculateRentalIncomeTaxCents(
          taxable,
          t.marginalTaxRateBps,
        );
        if (incomeTax < 0) {
          hadRefunds = true;
        }
      }
      const cf = cfBeforeTax - incomeTax;
      if (monthCounter === 1) {
        initialMonthlyCashflowCents = cf;
        initialMonthlyCashflowBeforeTaxCents = cfBeforeTax;
      }
      cashflowYear += cf;
      cashflowBeforeTaxYear += cfBeforeTax;
      depreciationYear += afa;
      taxableYear += taxable;
      incomeTaxYear += incomeTax;

      etf = applyMonthlyGrowth(etf, factor);
      if (reinvest) {
        depot = applyMonthlyGrowth(depot, factor);
      }
      if (cf < 0) {
        etf += -cf;
        paidIn += -cf;
        topUpYear += -cf;
        hadTopUps = true;
      } else if (cf > 0) {
        surplus += cf;
        surplusYear += cf;
        hadSurplus = true;
        if (reinvest) {
          depot += cf;
          depotPaidIn += cf;
        }
      }
    }

    assertSafeInteger(etf, "etfValueCents");
    assertSafeInteger(surplus, "accumulatedSurplusCents");
    assertSafeInteger(depot, "surplusDepotValueCents");
    assertSafeInteger(depotPaidIn, "surplusDepotPaidInCents");
    value = stepByBps(value, input.valueGrowthBps);
    const netWorth = value - debt + (reinvest ? depot : surplus);
    assertSafeInteger(netWorth, "propertyNetWorthCents");
    const liq = liquidationFields(
      y,
      value,
      debt,
      surplus,
      etf,
      paidIn,
      depot,
      depotPaidIn,
    );

    years.push({
      year: y,
      propertyValueCents: value,
      remainingDebtCents: debt,
      accumulatedSurplusCents: surplus,
      propertyNetWorthCents: netWorth,
      etfValueCents: etf,
      etfPaidInCents: paidIn,
      ...liq,
      monthlyColdRentCents: rent,
      coldRentYearCents: rent * 12,
      vacancyYearCents: vacancy * 12,
      hoaCostsYearCents: hoa * 12,
      maintenanceReserveYearCents: reserve * 12,
      interestYearCents: interestYear,
      principalYearCents: debtStart - debt,
      cashflowYearCents: assertSafeInteger(cashflowYear, "cashflowYearCents"),
      etfTopUpYearCents: topUpYear,
      surplusYearCents: surplusYear,
      cashflowBeforeTaxYearCents: assertSafeInteger(
        cashflowBeforeTaxYear,
        "cashflowBeforeTaxYearCents",
      ),
      depreciationYearCents: depreciationYear,
      cumulativeDepreciationCents: cumulativeDepreciation,
      taxableRentalIncomeYearCents: assertSafeInteger(
        taxableYear,
        "taxableRentalIncomeYearCents",
      ),
      rentalIncomeTaxYearCents: assertSafeInteger(
        incomeTaxYear,
        "rentalIncomeTaxYearCents",
      ),
      reserveDeductionYearCents: reserveDeductionYear,
    });
  }

  const last = years[years.length - 1]!;
  const firstLead = years.find((row) => row.advantageCents >= 0);
  const noAmortization =
    loanPrincipalCents > 0 &&
    monthlyLoanRateCents <=
      calculateMonthlyInterestCents(loanPrincipalCents, input.interestRateBps);

  return {
    purchaseCostsCents,
    totalCostCents,
    loanPrincipalCents,
    monthlyLoanRateCents,
    initialMonthlyColdRentCents: initialRent,
    initialMonthlyCashflowCents,
    initialMonthlyCashflowBeforeTaxCents,
    taxesEnabled: t.taxesEnabled,
    reinvestSurplus: reinvest,
    reserveDeductionLagYears: t.taxesEnabled ? t.reserveDeductionLagYears : 0,
    depreciationBasisCents,
    annualDepreciationCents,
    speculationFreeFromYear: t.taxesEnabled
      ? t.speculationPeriodYears + 1
      : null,
    loanPaidOffInMonth,
    years,
    final: {
      propertyNetWorthCents: last.propertyNetWorthCents,
      etfNetWorthCents: last.etfValueCents,
      propertyLiquidationCents: last.propertyLiquidationCents,
      etfLiquidationCents: last.etfLiquidationCents,
      advantageCents: last.advantageCents,
      propertyLiquidationWithoutDepotCents:
        last.propertyLiquidationWithoutDepotCents,
      surplusDepotValueCents: last.surplusDepotValueCents,
      surplusDepotPaidInCents: last.surplusDepotPaidInCents,
      surplusDepotTaxCents: last.surplusDepotTaxCents,
      surplusDepotNetCents: last.surplusDepotNetCents,
    },
    breakEven: firstLead
      ? { kind: "year", year: firstLead.year }
      : { kind: "never" },
    leadsAtHorizon: last.advantageCents >= 0,
    flags: {
      noLoan: loanPrincipalCents === 0,
      noAmortization,
      loanPaidOffWithinHorizon: loanPaidOffInMonth !== null,
      hadTopUps,
      hadSurplus,
      hadRefunds,
      speculationTaxApplied,
      reserveDeductionDeferred:
        t.taxesEnabled &&
        t.reserveDeductionLagYears >= 1 &&
        (reserveByYear[input.horizonYears] ?? 0) > 0,
    },
  };
}
