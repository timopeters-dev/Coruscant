import { calculateMonthlyInterestCents } from "./contracts";
import {
  assertNonNegativeInteger,
  assertSafeInteger,
  roundHalfUpBigInt,
} from "./money";
import { calculateLoanMonthlyRateCents } from "./property-purchase";
import {
  calculatePurchaseCostsCents,
  PROPERTY_VS_ETF_LIMITS,
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
}

export interface PropertyVsEtfYear {
  year: number;
  propertyValueCents: number;
  remainingDebtCents: number;
  accumulatedSurplusCents: number;
  propertyNetWorthCents: number;
  etfValueCents: number;
  etfPaidInCents: number;
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
  initialMonthlyCashflowCents: number;
  loanPaidOffInMonth: number | null;
  years: PropertyVsEtfYear[];
  final: {
    propertyNetWorthCents: number;
    etfNetWorthCents: number;
    advantageCents: number;
  };
  breakEven: PropertyVsEtfBreakEven;
  leadsAtHorizon: boolean;
  flags: {
    noLoan: boolean;
    noAmortization: boolean;
    loanPaidOffWithinHorizon: boolean;
    hadTopUps: boolean;
    hadSurplus: boolean;
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

export function simulatePropertyVsEtf(
  input: PropertyVsEtfInput,
): PropertyVsEtfResult {
  validatePropertyVsEtfInput(input);

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
  let loanPaidOffInMonth: number | null = null;
  let monthCounter = 0;
  let initialMonthlyCashflowCents = 0;
  let hadTopUps = false;
  let hadSurplus = false;

  const years: PropertyVsEtfYear[] = [];
  const row0NetWorth = value - debt;
  years.push({
    year: 0,
    propertyValueCents: value,
    remainingDebtCents: debt,
    accumulatedSurplusCents: 0,
    propertyNetWorthCents: row0NetWorth,
    etfValueCents: etf,
    etfPaidInCents: paidIn,
    advantageCents: row0NetWorth - etf,
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
  });

  for (let y = 1; y <= input.horizonYears; y += 1) {
    if (y >= 2) {
      rent = stepByBps(rent, input.rentGrowthBps);
      hoa = stepByBps(hoa, input.costGrowthBps);
    }
    const vacancy = shareOfBps(rent, input.vacancyBps);
    const reserve = monthlyShareOfAnnualBps(value, input.maintenanceReserveBps);
    const debtStart = debt;

    let interestYear = 0;
    let cashflowYear = 0;
    let topUpYear = 0;
    let surplusYear = 0;

    for (let m = 1; m <= 12; m += 1) {
      monthCounter += 1;
      const interest = calculateMonthlyInterestCents(debt, input.interestRateBps);
      const payment = Math.min(monthlyLoanRateCents, debt + interest);
      debt = debt + interest - payment;
      if (loanPrincipalCents > 0 && debt === 0 && loanPaidOffInMonth === null) {
        loanPaidOffInMonth = monthCounter;
      }
      interestYear += interest;

      const cf = rent - vacancy - hoa - reserve - payment;
      if (monthCounter === 1) {
        initialMonthlyCashflowCents = cf;
      }
      cashflowYear += cf;

      etf = applyMonthlyGrowth(etf, factor);
      if (cf < 0) {
        etf += -cf;
        paidIn += -cf;
        topUpYear += -cf;
        hadTopUps = true;
      } else if (cf > 0) {
        surplus += cf;
        surplusYear += cf;
        hadSurplus = true;
      }
    }

    assertSafeInteger(etf, "etfValueCents");
    assertSafeInteger(surplus, "accumulatedSurplusCents");
    value = stepByBps(value, input.valueGrowthBps);
    const netWorth = value - debt + surplus;
    assertSafeInteger(netWorth, "propertyNetWorthCents");

    years.push({
      year: y,
      propertyValueCents: value,
      remainingDebtCents: debt,
      accumulatedSurplusCents: surplus,
      propertyNetWorthCents: netWorth,
      etfValueCents: etf,
      etfPaidInCents: paidIn,
      advantageCents: netWorth - etf,
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
    loanPaidOffInMonth,
    years,
    final: {
      propertyNetWorthCents: last.propertyNetWorthCents,
      etfNetWorthCents: last.etfValueCents,
      advantageCents: last.advantageCents,
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
    },
  };
}
