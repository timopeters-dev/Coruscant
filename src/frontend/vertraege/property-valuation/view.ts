import type { PropertyValuationHistoryRow } from "@/backend/db/schema";
import type { ValuatorErrorCode } from "@/backend/integrations/property-valuator";
import { formatBpsDE } from "@/domain/core/money";
import type {
  PlannedConsumptionSummary,
  QuotaEvaluation,
  QuotaSnapshot,
} from "@/domain/properties/valuation/auto-schedule";
import { applyValuationAdjustmentToBounds } from "@/domain/properties/valuation/adjustments";
import type {
  ValuationRejectReason, ValuationWarning,
} from "@/domain/properties/valuation/valuation";
import { VALUATION_ERROR_CODE_LABELS, VALUATION_REJECT_REASON_LABELS } from "../labels";

export interface CardErrorState {
  tone: "rose" | "amber";
  message: string;
}

export interface ValuationStatusResponse {
  configured: boolean;
  scheduler: {
    running: boolean;
    jobs: Array<{
      jobId: string;
      enabled: boolean;
      lastStatus: string | null;
      lastRunAt: string | null;
      message: string;
      nextSlotAt: string;
    }>;
  };
  quota: {
    snapshot: QuotaSnapshot | null;
    evaluation: QuotaEvaluation;
  };
  plannedConsumption: PlannedConsumptionSummary;
}

export interface PendingSuggestionView {
  historyId: string;
  lowerCents: number;
  medianCents: number;
  upperCents: number;
  adjustmentBps: number;
  adjustedLowerCents: number;
  adjustedMedianCents: number;
  adjustedUpperCents: number;
  asOfDate: string;
  valuedAtDate: string;
  confidence: "low" | "medium" | "high" | null;
  confidenceScore: number | null;
  pricePerSqmMedianCents: number | null;
  rationale: string | null;
  limitations: string[];
  factors: Array<{ label: string; effect: "up" | "down" | "neutral" }>;
  cached: boolean;
  warnings: ValuationWarning[];
}

export type PendingSuggestionApiRow = PropertyValuationHistoryRow & {
  adjustedLowerCents?: number;
  adjustedMedianCents?: number;
  adjustedUpperCents?: number;
};


export function formatSignedBps(bps: number): string {
  if (bps === 0) return "0,00 %";
  return `${bps > 0 ? "+" : ""}${formatBpsDE(bps)}`;
}

export function mapApiErrorToState(
  code: string | undefined,
  reason: string | undefined,
  fallbackError: string | undefined,
): CardErrorState {
  if (code === "valuation_rejected" && reason) {
    const label =
      reason in VALUATION_REJECT_REASON_LABELS
        ? VALUATION_REJECT_REASON_LABELS[reason as ValuationRejectReason]
        : "Wertschätzung konnte nicht plausibilisiert werden.";
    return { tone: "amber", message: label };
  }
  if (code && code in VALUATION_ERROR_CODE_LABELS) {
    const errCode = code as ValuatorErrorCode;
    const tone =
      errCode === "not_valuable" || errCode === "quota_exceeded"
        ? "amber"
        : "rose";
    return {
      tone,
      message: VALUATION_ERROR_CODE_LABELS[errCode],
    };
  }
  return {
    tone: "rose",
    message: fallbackError ?? "Wertschätzung fehlgeschlagen.",
  };
}

const berlinDateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Berlin",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export function toBerlinDateKeyClient(isoTimestamp: string): string {
  return berlinDateFormatter.format(new Date(isoTimestamp));
}

export function formatDeviationPercent(deviationBps: number): string {
  const sign = deviationBps >= 0 ? "+" : "−";
  return `${sign}${formatBpsDE(Math.abs(deviationBps))}`;
}

export function mapHistoryToSuggestion(
  row: PendingSuggestionApiRow,
  fallbackAdjustmentBps = 0,
): PendingSuggestionView {
  const adjustmentBps = row.adjustmentBps ?? fallbackAdjustmentBps;
  const bounds = applyValuationAdjustmentToBounds(
    {
      lowerCents: row.lowerCents,
      medianCents: row.medianCents,
      upperCents: row.upperCents,
    },
    adjustmentBps,
  );
  return {
    historyId: row.id,
    lowerCents: row.lowerCents,
    medianCents: row.medianCents,
    upperCents: row.upperCents,
    adjustmentBps,
    adjustedLowerCents: row.adjustedLowerCents ?? bounds.lowerCents,
    adjustedMedianCents: row.adjustedMedianCents ?? bounds.medianCents,
    adjustedUpperCents: row.adjustedUpperCents ?? bounds.upperCents,
    asOfDate: row.dataAsOf ?? toBerlinDateKeyClient(row.valuedAt),
    valuedAtDate: toBerlinDateKeyClient(row.valuedAt),
    confidence: row.confidence,
    confidenceScore: row.confidenceScore,
    pricePerSqmMedianCents: null,
    rationale: null,
    limitations: [],
    factors: [],
    cached: false,
    warnings: [],
  };
}
