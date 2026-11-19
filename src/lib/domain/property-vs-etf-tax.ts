import { divRoundHalfUpSigned, assertNonNegativeInteger, assertSafeInteger, roundHalfUpBigInt } from "./money";
import {
  PROPERTY_VS_ETF_TAX_LIMITS,
} from "./property-vs-etf-defaults";
import { ALLOWED_CHURCH_TAX_BPS, calculateEtfLiquidationTax } from "./scenarios";

/**
 * Vereinfachte Steuerlogik, keine Steuerberatung (Modelliert).
 *
 * Vereinfachungen: lineare AfA ab Monat 1 (keine zeitanteilige Kürzung), AfA-Basis
 * inkl. anteiliger Nebenkosten, Verluste werden im selben Monat erstattet
 * (kein Verlustvortrag), Instandhaltungsrücklage gilt als abzugsfähig (steuerlich
 * erst die Verwendung), Tilgung nicht abzugsfähig, Spekulationsfrist: Jahr ≤ Frist
 * steuerpflichtig, keine Verlustverrechnung, ETF: einmaliger Sparerpauschbetrag
 * beim fiktiven Verkauf, keine Vorabpauschale.
 */
export interface PropertyVsEtfTaxInput {
  taxesEnabled: boolean;
  /** Persönlicher Grenzsteuersatz inkl. Soli (ggf. KiSt), für V+V und § 23. */
  marginalTaxRateBps: number;
  depreciationRateBps: number;
  /** Anteil des Gebäudes an Kaufpreis + Nebenkosten (Rest = Boden, nicht abschreibbar). */
  buildingShareBps: number;
  /** Verkauf im Jahr y ≤ Frist ist steuerpflichtig. */
  speculationPeriodYears: number;
  saverAllowanceCents: number;
  partialExemptionBps: number;
  churchTaxBps: number;
  /** Verkaufskosten in % vom Verkaufswert, wirken auch bei taxesEnabled = false. */
  saleCostsBps: number;
}

const RANGE_KEYS = [
  "marginalTaxRateBps",
  "depreciationRateBps",
  "buildingShareBps",
  "speculationPeriodYears",
  "saverAllowanceCents",
  "partialExemptionBps",
  "saleCostsBps",
] as const satisfies readonly (keyof PropertyVsEtfTaxInput)[];

export function validatePropertyVsEtfTaxInput(tax: PropertyVsEtfTaxInput): void {
  if (typeof tax.taxesEnabled !== "boolean") {
    throw new TypeError(
      `taxesEnabled must be a boolean, received: ${String(tax.taxesEnabled)}`,
    );
  }
  for (const key of RANGE_KEYS) {
    const { min, max } = PROPERTY_VS_ETF_TAX_LIMITS[key];
    const value = assertSafeInteger(tax[key], key);
    if (value < min || value > max) {
      throw new RangeError(
        `${key} must be between ${min} and ${max}, received: ${value}`,
      );
    }
  }
  const kist = assertSafeInteger(tax.churchTaxBps, "churchTaxBps");
  if (!(ALLOWED_CHURCH_TAX_BPS as readonly number[]).includes(kist)) {
    throw new RangeError(
      `churchTaxBps must be one of ${ALLOWED_CHURCH_TAX_BPS.join(", ")}, received: ${kist}`,
    );
  }
}

function shareHalfUp(baseCents: number, bps: number): number {
  return assertSafeInteger(
    Number(roundHalfUpBigInt(BigInt(baseCents) * BigInt(bps), 10_000n)),
    "shareCents",
  );
}

/** roundHalfUp(Gesamtkosten × Gebäudeanteil). */
export function calculateDepreciationBasisCents(
  totalCostCents: number,
  buildingShareBps: number,
): number {
  return shareHalfUp(
    assertNonNegativeInteger(totalCostCents, "totalCostCents"),
    assertNonNegativeInteger(buildingShareBps, "buildingShareBps"),
  );
}

/** roundHalfUp(Basis × AfA-Satz) = jährliche lineare AfA. */
export function calculateAnnualDepreciationCents(
  depreciationBasisCents: number,
  depreciationRateBps: number,
): number {
  return shareHalfUp(
    assertNonNegativeInteger(depreciationBasisCents, "depreciationBasisCents"),
    assertNonNegativeInteger(depreciationRateBps, "depreciationRateBps"),
  );
}

/** Monats-AfA: floor(annual/12) in Monat 1–11, Rest in Monat 12, gedeckelt auf den Restbuchwert. */
export function depreciationForMonthCents(
  annualCents: number,
  monthOfYear: number,
  remainingBasisCents: number,
): number {
  const annual = assertNonNegativeInteger(annualCents, "annualCents");
  if (!Number.isInteger(monthOfYear) || monthOfYear < 1 || monthOfYear > 12) {
    throw new RangeError(`monthOfYear must be 1..12, received: ${monthOfYear}`);
  }
  const remaining = assertNonNegativeInteger(
    remainingBasisCents,
    "remainingBasisCents",
  );
  const base = Math.floor(annual / 12);
  const planned = monthOfYear === 12 ? annual - 11 * base : base;
  return Math.min(planned, remaining);
}

/** Einkommensteuer auf V+V-Ergebnis, vorzeichenbehaftet (negativ = Erstattung). */
export function calculateRentalIncomeTaxCents(
  taxableCents: number,
  marginalTaxRateBps: number,
): number {
  const taxable = assertSafeInteger(taxableCents, "taxableCents");
  const rate = assertNonNegativeInteger(marginalTaxRateBps, "marginalTaxRateBps");
  return divRoundHalfUpSigned(BigInt(taxable) * BigInt(rate), 10_000n);
}

export function isWithinSpeculationPeriod(
  yearsHeld: number,
  speculationPeriodYears: number,
): boolean {
  return yearsHeld <= speculationPeriodYears;
}

export interface PropertySaleResult {
  saleCostsCents: number;
  netProceedsCents: number;
  speculationGainCents: number;
  speculationTaxCents: number;
}

export function calculatePropertySale(args: {
  valueCents: number;
  totalCostCents: number;
  cumulativeDepreciationCents: number;
  yearsHeld: number;
  tax: PropertyVsEtfTaxInput;
}): PropertySaleResult {
  const { tax } = args;
  const value = assertNonNegativeInteger(args.valueCents, "valueCents");
  const saleCostsCents = shareHalfUp(value, tax.saleCostsBps);
  const netProceedsCents = value - saleCostsCents;
  const basis =
    assertNonNegativeInteger(args.totalCostCents, "totalCostCents") -
    assertNonNegativeInteger(
      args.cumulativeDepreciationCents,
      "cumulativeDepreciationCents",
    );
  const speculationGainCents = assertSafeInteger(
    netProceedsCents - basis,
    "speculationGainCents",
  );
  const speculationTaxCents =
    tax.taxesEnabled &&
    isWithinSpeculationPeriod(args.yearsHeld, tax.speculationPeriodYears) &&
    speculationGainCents > 0
      ? shareHalfUp(speculationGainCents, tax.marginalTaxRateBps)
      : 0;
  return {
    saleCostsCents,
    netProceedsCents,
    speculationGainCents,
    speculationTaxCents,
  };
}

export function calculateEtfLiquidation(args: {
  valueCents: number;
  paidInCents: number;
  tax: PropertyVsEtfTaxInput;
}): { etfTaxCents: number; etfLiquidationCents: number } {
  if (!args.tax.taxesEnabled) {
    return { etfTaxCents: 0, etfLiquidationCents: args.valueCents };
  }
  const b = calculateEtfLiquidationTax({
    valueCents: args.valueCents,
    costBasisCents: args.paidInCents,
    saverAllowanceCents: args.tax.saverAllowanceCents,
    churchTaxBps: args.tax.churchTaxBps,
    partialExemptionBps: args.tax.partialExemptionBps,
  });
  return { etfTaxCents: b.totalTaxCents, etfLiquidationCents: b.netValueCents };
}
