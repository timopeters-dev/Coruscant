import { addMonthsToIsoDate, parseIsoDate } from "./date";
import {
  assertSafeInteger,
  divRoundHalfUpSigned,
  roundHalfUpBigInt,
} from "./money";
import type { PropertyValuationContext } from "./property-valuation-context";

/** Plausibilitäts-Richtwerte für die Immobilien-Wertschätzung (Orientierung, kein Gutachten). */
export const MIN_PRICE_PER_SQM_CENTS = 30_000;
export const MAX_PRICE_PER_SQM_CENTS = 3_000_000;
export const MAX_SPREAD_RATIO_BPS = 20_000;
export const MAX_AS_OF_AGE_MONTHS = 24;
export const DEVIATION_WARN_BPS = 4_000;

export type ValuationFactorEffect = "up" | "down" | "neutral";
export type ValuationConfidence = "low" | "medium" | "high";

export interface ValuationFactor {
  label: string;
  effect: ValuationFactorEffect;
}

export interface ValuationSource {
  uri: string;
  title: string;
}

export interface ValuationModelOutputInput {
  lowerEur: number;
  medianEur: number;
  upperEur: number;
  asOfDate: string;
  rationale: string;
  factors: ValuationFactor[];
  confidence: ValuationConfidence;
}

export interface PropertyValuation {
  lowerCents: number;
  medianCents: number;
  upperCents: number;
  pricePerSqmMedianCents: number;
  asOfDate: string;
  rationale: string;
  factors: ValuationFactor[];
  confidence: ValuationConfidence;
  sources: ValuationSource[];
  searchQueries: string[];
}

export type ValuationRejectReason =
  | "ungrounded"
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
  rawOutput: ValuationModelOutputInput;
  sources: ValuationSource[];
  searchQueries: string[];
  context: PropertyValuationContext;
  currentValueCents: number;
  today: string;
}

function eurToCentsSafe(eur: number): number | null {
  if (!Number.isSafeInteger(eur) || eur <= 0) {
    return null;
  }
  try {
    return assertSafeInteger(eur * 100, "valuationEurCents");
  } catch {
    return null;
  }
}

export function validatePropertyValuation(
  input: ValidatePropertyValuationInput,
): ValidatePropertyValuationResult {
  const { rawOutput, sources, searchQueries, context, currentValueCents, today } =
    input;

  if (sources.length === 0) {
    return { ok: false, reason: "ungrounded" };
  }

  const lowerCents = eurToCentsSafe(rawOutput.lowerEur);
  const medianCents = eurToCentsSafe(rawOutput.medianEur);
  const upperCents = eurToCentsSafe(rawOutput.upperEur);

  if (lowerCents === null || medianCents === null || upperCents === null) {
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
  parseIsoDate(rawOutput.asOfDate, "asOfDate");

  if (rawOutput.asOfDate > today) {
    return { ok: false, reason: "as_of_in_future" };
  }

  if (addMonthsToIsoDate(rawOutput.asOfDate, MAX_AS_OF_AGE_MONTHS) < today) {
    return { ok: false, reason: "as_of_too_old" };
  }

  const warnings: ValuationWarning[] = [];
  if (currentValueCents > 0) {
    const diff = BigInt(medianCents) - BigInt(currentValueCents);
    const absDiff = diff < 0n ? -diff : diff;
    if (
      absDiff * 10_000n >
      BigInt(currentValueCents) * BigInt(DEVIATION_WARN_BPS)
    ) {
      warnings.push({
        code: "deviates_from_current",
        deviationBps: divRoundHalfUpSigned(
          diff * 10_000n,
          BigInt(currentValueCents),
        ),
      });
    }
  }

  return {
    ok: true,
    valuation: {
      lowerCents,
      medianCents,
      upperCents,
      pricePerSqmMedianCents,
      asOfDate: rawOutput.asOfDate,
      rationale: rawOutput.rationale,
      factors: rawOutput.factors,
      confidence: rawOutput.confidence,
      sources,
      searchQueries,
    },
    warnings,
  };
}
