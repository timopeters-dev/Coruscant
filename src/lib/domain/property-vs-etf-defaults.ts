import { assertNonNegativeInteger, roundHalfUpBigInt } from "./money";
import {
  CURRENT_PURCHASE_COST_RULE_SET,
  PROPERTY_PURCHASE_LIMITS,
  type PurchaseCostRuleSet,
} from "./property-purchase-defaults";
import { MAX_ETF_RETURN_BPS, MIN_ETF_RETURN_BPS } from "./scenarios";

/** Summe aller Nebenkosten-Posten eines Regelwerks in Basispunkten. */
export function sumPurchaseCostRuleSetBps(ruleSet: PurchaseCostRuleSet): number {
  return ruleSet.items.reduce((sum, item) => sum + item.bps, 0);
}

/** Kaufnebenkosten in Cent: roundHalfUp(Kaufpreis × bps / 10_000). */
export function calculatePurchaseCostsCents(
  purchasePriceCents: number,
  purchaseCostsBps: number,
): number {
  const price = assertNonNegativeInteger(purchasePriceCents, "purchasePriceCents");
  const bps = assertNonNegativeInteger(purchaseCostsBps, "purchaseCostsBps");
  return Number(roundHalfUpBigInt(BigInt(price) * BigInt(bps), 10_000n));
}

/** Standard-Eigenkapital = genau die Kaufnebenkosten (Darlehen = Kaufpreis). */
export function defaultEquityCents(
  purchasePriceCents: number,
  purchaseCostsBps: number,
): number {
  return calculatePurchaseCostsCents(purchasePriceCents, purchaseCostsBps);
}

export const PROPERTY_VS_ETF_LIMITS = {
  purchasePriceCents: { min: 1, max: 10_000_000_000 },
  livingAreaCentiSqm: { min: 1, max: 100_000 },
  coldRentPerSqmCents: { min: 0, max: 10_000 },
  purchaseCostsBps: { min: 0, max: 3_000 },
  equityCents: { min: 0, max: 20_000_000_000 },
  interestRateBps: PROPERTY_PURCHASE_LIMITS.interestRateBps,
  initialRepaymentBps: PROPERTY_PURCHASE_LIMITS.initialRepaymentBps,
  rentGrowthBps: { min: -1_000, max: 1_000 },
  valueGrowthBps: { min: -1_000, max: 1_000 },
  costGrowthBps: { min: -1_000, max: 1_000 },
  vacancyBps: { min: 0, max: 5_000 },
  monthlyHoaCostsCents: { min: 0, max: 10_000_000 },
  maintenanceReserveBps: { min: 0, max: 500 },
  etfAnnualReturnBps: { min: MIN_ETF_RETURN_BPS, max: MAX_ETF_RETURN_BPS },
  horizonYears: { min: 1, max: 40 },
} as const;

/** Reglerbereiche für 25c (UI-Empfehlung, enger als die Domänengrenzen). */
export const PROPERTY_VS_ETF_SLIDER_RANGES = {
  maintenanceReserveBps: { min: 50, max: 150 },
  horizonYears: { min: 1, max: 40 },
} as const;

/** Standardannahmen (Objektdaten sind Pflicht und daher nicht enthalten). */
export const PROPERTY_VS_ETF_DEFAULTS = {
  purchaseCostsBps: sumPurchaseCostRuleSetBps(CURRENT_PURCHASE_COST_RULE_SET),
  interestRateBps: 380,
  initialRepaymentBps: 200,
  rentGrowthBps: 200,
  valueGrowthBps: 200,
  costGrowthBps: 200,
  vacancyBps: 200,
  monthlyHoaCostsCents: 3_000,
  maintenanceReserveBps: 100,
  etfAnnualReturnBps: 600,
  horizonYears: 20,
} as const;
