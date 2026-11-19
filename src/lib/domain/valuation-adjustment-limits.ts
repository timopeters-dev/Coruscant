export const MAX_VALUATION_ADJUSTMENTS = 8;
export const MAX_ADJUSTMENT_ITEM_BPS = 5_000;
export const MAX_ADJUSTMENT_TOTAL_BPS = 5_000;
export const MAX_ADJUSTMENT_LABEL_LENGTH = 60;

export interface ValuationAdjustment {
  label: string;
  bps: number;
  catalogKey?: string;
}

export function normalizeAdjustmentLabel(label: string): string {
  return label.trim().replace(/\s+/g, " ");
}
