import { addMonthsToIsoDate, parseIsoDate } from "@/domain/core/date";
import { divRoundHalfUpSigned, roundHalfUpBigInt } from "@/domain/core/money";
import { applyValuationAdjustmentToBounds } from "./adjustments";
import type { PropertyValuationContext } from "./context";

/** Plausibilitäts-Richtwerte für die Immobilien-Wertschätzung (Orientierung, kein Gutachten). */
export const MIN_PRICE_PER_SQM_CENTS = 30_000;
export const MAX_PRICE_PER_SQM_CENTS = 3_000_000;
export const MAX_SPREAD_RATIO_BPS = 20_000;
export const MAX_AS_OF_AGE_MONTHS = 24;
export const DEVIATION_WARN_BPS = 4_000;

export type ValuationFactorEffect = "up" | "down" | "neutral";
export type ValuationConfidence = "low" | "medium" | "high";
export type ValuationValuability =
  | "valuable"
  | "valuable_with_limitations"
  | "not_reliably_valuable";

export interface ValuationFactor {
  label: string;
  effect: ValuationFactorEffect;
}

export interface NormalizedValuationResult {
  requestId: string;
  cached: boolean;
  valuability: ValuationValuability;
  lowerCents: number | null;
  medianCents: number | null;
  upperCents: number | null;
  asOfDate: string;
  confidence: ValuationConfidence;
  confidenceScore: number | null;
  rationale: string;
  limitations: string[];
  factors: ValuationFactor[];
}

export interface PropertyValuation {
  lowerCents: number;
  medianCents: number;
  upperCents: number;
  adjustmentBps: number;
  adjustedLowerCents: number;
  adjustedMedianCents: number;
  adjustedUpperCents: number;
  pricePerSqmMedianCents: number;
  asOfDate: string;
  confidence: ValuationConfidence;
  confidenceScore: number | null;
  valuability: Exclude<ValuationValuability, "not_reliably_valuable">;
  rationale: string;
  limitations: string[];
  factors: ValuationFactor[];
  requestId: string;
  cached: boolean;
}

export type ValuationRejectReason =
  | "not_reliably_valuable"
  | "non_positive"
  | "bounds_order"
  | "price_per_sqm_out_of_range"
  | "spread_too_wide"
  | "as_of_in_future"
  | "as_of_too_old";

export interface ValuationWarning {
  code: "deviates_from_current";
  deviationBps: number;
}

export type ValidatePropertyValuationResult =
  | {
      ok: true;
      valuation: PropertyValuation;
      warnings: ValuationWarning[];
    }
  | {
      ok: false;
      reason: ValuationRejectReason;
    };

export interface ValidatePropertyValuationInput {
  normalized: NormalizedValuationResult;
  context: PropertyValuationContext;
  currentValueCents: number;
  today: string;
  adjustmentBps?: number;
}

function isPositiveSafeCents(value: number | null): value is number {
  return value !== null && Number.isSafeInteger(value) && value > 0;
}

export function computeValuationDeviationBps(
  medianCents: number,
  currentValueCents: number,
): number | null {
  if (!Number.isSafeInteger(currentValueCents) || currentValueCents <= 0) {
    return null;
  }
  if (!Number.isSafeInteger(medianCents)) {
    return null;
  }
  const diff = BigInt(medianCents) - BigInt(currentValueCents);
  return divRoundHalfUpSigned(diff * 10_000n, BigInt(currentValueCents));
}

export function isDeviationAboveThreshold(deviationBps: number | null): boolean {
  if (deviationBps === null) {
    return false;
  }
  return Math.abs(deviationBps) > DEVIATION_WARN_BPS;
}

export function validatePropertyValuation(
  input: ValidatePropertyValuationInput,
): ValidatePropertyValuationResult {
  const { normalized, context, currentValueCents, today } = input;
  const adjustmentBps = input.adjustmentBps ?? 0;

  if (normalized.valuability === "not_reliably_valuable") {
    return { ok: false, reason: "not_reliably_valuable" };
  }

  const { lowerCents, medianCents, upperCents } = normalized;
  if (
    !isPositiveSafeCents(lowerCents) ||
    !isPositiveSafeCents(medianCents) ||
    !isPositiveSafeCents(upperCents)
  ) {
    return { ok: false, reason: "non_positive" };
  }

  if (!(lowerCents <= medianCents && medianCents <= upperCents)) {
    return { ok: false, reason: "bounds_order" };
  }

  const pricePerSqmMedianCents = Number(
    roundHalfUpBigInt(
      BigInt(medianCents),
      BigInt(context.object.livingAreaSqm),
    ),
  );

  if (
    pricePerSqmMedianCents < MIN_PRICE_PER_SQM_CENTS ||
    pricePerSqmMedianCents > MAX_PRICE_PER_SQM_CENTS
  ) {
    return { ok: false, reason: "price_per_sqm_out_of_range" };
  }

  if (
    BigInt(upperCents) * 10_000n >
    BigInt(lowerCents) * BigInt(MAX_SPREAD_RATIO_BPS)
  ) {
    return { ok: false, reason: "spread_too_wide" };
  }

  parseIsoDate(today, "today");
  parseIsoDate(normalized.asOfDate, "asOfDate");

  if (normalized.asOfDate > today) {
    return { ok: false, reason: "as_of_in_future" };
  }

  if (addMonthsToIsoDate(normalized.asOfDate, MAX_AS_OF_AGE_MONTHS) < today) {
    return { ok: false, reason: "as_of_too_old" };
  }

  const adjustedBounds = applyValuationAdjustmentToBounds(
    { lowerCents, medianCents, upperCents },
    adjustmentBps,
  );

  const warnings: ValuationWarning[] = [];
  const deviationBps = computeValuationDeviationBps(
    adjustedBounds.medianCents,
    currentValueCents,
  );
  if (deviationBps !== null && isDeviationAboveThreshold(deviationBps)) {
    warnings.push({
      code: "deviates_from_current",
      deviationBps,
    });
  }

  return {
    ok: true,
    valuation: {
      lowerCents,
      medianCents,
      upperCents,
      adjustmentBps,
      adjustedLowerCents: adjustedBounds.lowerCents,
      adjustedMedianCents: adjustedBounds.medianCents,
      adjustedUpperCents: adjustedBounds.upperCents,
      pricePerSqmMedianCents,
      asOfDate: normalized.asOfDate,
      confidence: normalized.confidence,
      confidenceScore: normalized.confidenceScore,
      valuability: normalized.valuability,
      rationale: normalized.rationale,
      limitations: normalized.limitations,
      factors: normalized.factors,
      requestId: normalized.requestId,
      cached: normalized.cached,
    },
    warnings,
  };
}
