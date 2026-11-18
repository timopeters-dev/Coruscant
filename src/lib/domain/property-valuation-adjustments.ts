import { assertSafeInteger, formatBpsDE, roundHalfUpBigInt } from "./money";

export const MAX_VALUATION_ADJUSTMENTS = 8;
export const MAX_ADJUSTMENT_ITEM_BPS = 5_000;
export const MAX_ADJUSTMENT_TOTAL_BPS = 5_000;
export const MAX_ADJUSTMENT_LABEL_LENGTH = 60;

export interface ValuationAdjustment {
  label: string;
  bps: number;
}

export type ValuationAdjustmentErrorCode =
  | "too_many"
  | "label_empty"
  | "label_too_long"
  | "label_duplicate"
  | "bps_not_integer"
  | "bps_zero"
  | "bps_item_out_of_range"
  | "total_out_of_range";

export interface ValuationAdjustmentValidationError {
  index?: number;
  code: ValuationAdjustmentErrorCode;
}

export type ValidateValuationAdjustmentsResult =
  | { ok: true }
  | { ok: false; errors: ValuationAdjustmentValidationError[] };

export function normalizeAdjustmentLabel(label: string): string {
  return label.trim().replace(/\s+/g, " ");
}

export function normalizeValuationAdjustments(
  raw: unknown,
): ValuationAdjustment[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  const seenLabels = new Set<string>();
  const normalized: ValuationAdjustment[] = [];
  let runningTotal = 0;

  for (const item of raw) {
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      continue;
    }
    const candidate = item as Record<string, unknown>;
    if (
      typeof candidate.label !== "string" ||
      typeof candidate.bps !== "number"
    ) {
      continue;
    }

    const label = normalizeAdjustmentLabel(candidate.label);
    if (label.length === 0 || label.length > MAX_ADJUSTMENT_LABEL_LENGTH) {
      continue;
    }

    const bps = candidate.bps;
    if (
      !Number.isSafeInteger(bps) ||
      bps === 0 ||
      Math.abs(bps) > MAX_ADJUSTMENT_ITEM_BPS
    ) {
      continue;
    }

    const key = label.toLocaleLowerCase("de-DE");
    if (seenLabels.has(key)) {
      continue;
    }

    if (Math.abs(runningTotal + bps) > MAX_ADJUSTMENT_TOTAL_BPS) {
      continue;
    }

    seenLabels.add(key);
    runningTotal += bps;
    normalized.push({ label, bps: bps === 0 ? 0 : bps });

    if (normalized.length >= MAX_VALUATION_ADJUSTMENTS) {
      break;
    }
  }

  return normalized;
}

export function parseValuationAdjustments(
  raw: string | null,
): ValuationAdjustment[] {
  if (!raw || raw.trim().length === 0) {
    return [];
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }

  return normalizeValuationAdjustments(parsed);
}

export function serializeValuationAdjustments(
  list: readonly ValuationAdjustment[],
): string | null {
  const normalized = normalizeValuationAdjustments(list);
  if (normalized.length === 0) {
    return null;
  }
  return JSON.stringify(normalized);
}

export function validateValuationAdjustments(
  list: readonly ValuationAdjustment[],
): ValidateValuationAdjustmentsResult {
  const errors: ValuationAdjustmentValidationError[] = [];

  if (list.length > MAX_VALUATION_ADJUSTMENTS) {
    errors.push({ code: "too_many" });
  }

  const seenLabels = new Set<string>();
  let totalBps = 0;
  let allBpsIntegers = true;

  list.forEach((item, index) => {
    const label = normalizeAdjustmentLabel(item.label);
    if (label.length === 0) {
      errors.push({ index, code: "label_empty" });
    } else if (label.length > MAX_ADJUSTMENT_LABEL_LENGTH) {
      errors.push({ index, code: "label_too_long" });
    } else {
      const key = label.toLocaleLowerCase("de-DE");
      if (seenLabels.has(key)) {
        errors.push({ index, code: "label_duplicate" });
      } else {
        seenLabels.add(key);
      }
    }

    if (!Number.isSafeInteger(item.bps)) {
      allBpsIntegers = false;
      errors.push({ index, code: "bps_not_integer" });
    } else if (item.bps === 0) {
      errors.push({ index, code: "bps_zero" });
    } else if (Math.abs(item.bps) > MAX_ADJUSTMENT_ITEM_BPS) {
      errors.push({ index, code: "bps_item_out_of_range" });
    } else {
      totalBps += item.bps;
    }
  });

  if (allBpsIntegers && Math.abs(totalBps) > MAX_ADJUSTMENT_TOTAL_BPS) {
    errors.push({ code: "total_out_of_range" });
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }
  return { ok: true };
}

export function sumAdjustmentBps(list: readonly ValuationAdjustment[]): number {
  let total = 0;
  for (let i = 0; i < list.length; i++) {
    const bps = assertSafeInteger(list[i]!.bps, `adjustments[${i}].bps`);
    total += bps;
  }
  if (Math.abs(total) > MAX_ADJUSTMENT_TOTAL_BPS) {
    throw new RangeError(
      `Total adjustment bps (${total}) exceeds ±${MAX_ADJUSTMENT_TOTAL_BPS}`,
    );
  }
  return total === 0 ? 0 : total;
}

export function applyValuationAdjustment(
  cents: number,
  totalBps: number,
): number {
  const safeCents = assertSafeInteger(cents, "cents");
  if (safeCents <= 0) {
    throw new RangeError(
      `cents must be a positive safe integer, received: ${String(cents)}`,
    );
  }

  const safeBps = assertSafeInteger(totalBps, "totalBps");
  if (Math.abs(safeBps) > MAX_ADJUSTMENT_TOTAL_BPS) {
    throw new RangeError(
      `totalBps (${safeBps}) must be between -${MAX_ADJUSTMENT_TOTAL_BPS} and ${MAX_ADJUSTMENT_TOTAL_BPS}`,
    );
  }

  if (safeBps === 0) {
    return safeCents;
  }

  const factor = BigInt(10_000 + safeBps);
  const adjusted = roundHalfUpBigInt(BigInt(safeCents) * factor, 10_000n);
  return assertSafeInteger(Number(adjusted), "adjustedCents");
}

export interface ValuationBounds {
  lowerCents: number;
  medianCents: number;
  upperCents: number;
}

export function applyValuationAdjustmentToBounds(
  bounds: ValuationBounds,
  totalBps: number,
): ValuationBounds {
  return {
    lowerCents: applyValuationAdjustment(bounds.lowerCents, totalBps),
    medianCents: applyValuationAdjustment(bounds.medianCents, totalBps),
    upperCents: applyValuationAdjustment(bounds.upperCents, totalBps),
  };
}

export function formatAdjustmentSummary(
  list: readonly ValuationAdjustment[],
): string {
  if (list.length === 0) {
    return "";
  }
  return list
    .map((item) => {
      const prefix = item.bps > 0 ? "+" : "";
      return `${prefix}${formatBpsDE(item.bps)} · ${normalizeAdjustmentLabel(item.label)}`;
    })
    .join("; ");
}
