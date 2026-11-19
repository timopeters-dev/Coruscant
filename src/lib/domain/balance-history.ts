import type { BalanceSummary } from "./balance";
import {
  diffCalendarDays,
  parseIsoDate,
  subtractMonthsFromIsoDate,
  toYearMonth,
} from "./date";
import { assertNonNegativeInteger, assertSafeInteger } from "./money";

export interface BalanceHistoryPoint {
  date: string; // YYYY-MM-DD (Europe/Berlin)
  totalAssetsCents: number;
  liabilitiesCents: number;
  netWorthCents: number; // may be < 0
  freeAssetsCents: number;
  boundAssetsCents: number;
  propertiesValueCents: number;
  savingsContractsValueCents: number;
  hasModeledValues: boolean;
}

export type MarkedBalanceHistoryPoint = BalanceHistoryPoint & {
  gapBefore: boolean;
  gapDays: number | null;
};

export type HistoryRangeId = "3m" | "6m" | "12m" | "all";

export const HISTORY_RANGE_MONTHS = {
  "3m": 3,
  "6m": 6,
  "12m": 12,
} as const;

export const HISTORY_GAP_THRESHOLD_DAYS = 7;
export const HISTORY_MAX_POINTS = 400;

export interface HistoryRangeSummary {
  count: number;
  first: MarkedBalanceHistoryPoint | null;
  last: MarkedBalanceHistoryPoint | null;
  netWorthDeltaCents: number | null;
  gapCount: number;
  anyModeled: boolean;
}

export interface ComponentDeltas {
  sinceDate: string;
  freeAssetsDeltaCents: number;
  boundAssetsDeltaCents: number;
  liabilitiesDeltaCents: number;
}

export interface MonthEndHistoryRow {
  month: string; // YYYY-MM
  point: BalanceHistoryPoint;
}

/**
 * Builds a validated BalanceHistoryPoint from a household BalanceSummary.
 * Returns null for an empty balance sheet (0 assets and 0 liabilities).
 */
export function buildBalanceSnapshotRecord(
  summary: BalanceSummary,
  meta: { projectedContractsCount: number },
): BalanceHistoryPoint | null {
  parseIsoDate(summary.asOfDate, "asOfDate");

  const totalAssetsCents = assertNonNegativeInteger(
    summary.totalAssetsCents,
    "totalAssetsCents",
  );
  const liabilitiesCents = assertNonNegativeInteger(
    summary.liabilitiesCents,
    "liabilitiesCents",
  );
  const netWorthCents = assertSafeInteger(
    summary.netWorthCents,
    "netWorthCents",
  );
  const freeAssetsCents = assertNonNegativeInteger(
    summary.freeAssetsCents,
    "freeAssetsCents",
  );
  const boundAssetsCents = assertNonNegativeInteger(
    summary.boundAssetsCents,
    "boundAssetsCents",
  );
  const propertiesValueCents = assertNonNegativeInteger(
    summary.propertiesValueCents,
    "propertiesValueCents",
  );
  const savingsContractsValueCents = assertNonNegativeInteger(
    summary.savingsContractsValueCents,
    "savingsContractsValueCents",
  );
  const projectedContractsCount = assertNonNegativeInteger(
    meta.projectedContractsCount,
    "projectedContractsCount",
  );

  if (totalAssetsCents !== freeAssetsCents + boundAssetsCents) {
    throw new RangeError(
      `Balance invariant violated: totalAssetsCents (${totalAssetsCents}) !== freeAssetsCents (${freeAssetsCents}) + boundAssetsCents (${boundAssetsCents})`,
    );
  }
  if (
    boundAssetsCents !==
    propertiesValueCents + savingsContractsValueCents
  ) {
    throw new RangeError(
      `Balance invariant violated: boundAssetsCents (${boundAssetsCents}) !== propertiesValueCents (${propertiesValueCents}) + savingsContractsValueCents (${savingsContractsValueCents})`,
    );
  }
  if (netWorthCents !== totalAssetsCents - liabilitiesCents) {
    throw new RangeError(
      `Balance invariant violated: netWorthCents (${netWorthCents}) !== totalAssetsCents (${totalAssetsCents}) - liabilitiesCents (${liabilitiesCents})`,
    );
  }

  if (totalAssetsCents === 0 && liabilitiesCents === 0) {
    return null;
  }

  return {
    date: summary.asOfDate,
    totalAssetsCents,
    liabilitiesCents,
    netWorthCents,
    freeAssetsCents,
    boundAssetsCents,
    propertiesValueCents,
    savingsContractsValueCents,
    hasModeledValues: propertiesValueCents > 0 || projectedContractsCount > 0,
  };
}

/**
 * Sorts, deduplicates (last entry wins per date), and filters history points
 * to the inclusive range [from, todayIso]. Points after todayIso are discarded.
 */
export function filterHistoryByRange(
  points: readonly BalanceHistoryPoint[],
  range: HistoryRangeId,
  todayIso: string,
): { from: string | null; points: BalanceHistoryPoint[] } {
  parseIsoDate(todayIso, "todayIso");
  const from =
    range === "all"
      ? null
      : subtractMonthsFromIsoDate(todayIso, HISTORY_RANGE_MONTHS[range]);

  const byDate = new Map<string, BalanceHistoryPoint>();
  for (const point of points) {
    parseIsoDate(point.date, "point.date");
    byDate.set(point.date, point);
  }

  const filtered = Array.from(byDate.values())
    .filter((point) => {
      if (point.date > todayIso) {
        return false;
      }
      if (from !== null && point.date < from) {
        return false;
      }
      return true;
    })
    .sort((a, b) => a.date.localeCompare(b.date));

  return { from, points: filtered };
}

/**
 * Marks gaps where consecutive points are more than thresholdDays apart.
 */
export function markHistoryGaps(
  points: readonly BalanceHistoryPoint[],
  thresholdDays = HISTORY_GAP_THRESHOLD_DAYS,
): MarkedBalanceHistoryPoint[] {
  const safeThreshold = assertNonNegativeInteger(thresholdDays, "thresholdDays");
  const sorted = [...points].sort((a, b) => a.date.localeCompare(b.date));

  return sorted.map((point, index) => {
    if (index === 0) {
      return { ...point, gapBefore: false, gapDays: null };
    }
    const prev = sorted[index - 1]!;
    const diff = diffCalendarDays(prev.date, point.date);
    if (diff > safeThreshold) {
      return { ...point, gapBefore: true, gapDays: diff };
    }
    return { ...point, gapBefore: false, gapDays: null };
  });
}

function getIsoWeekKey(isoDate: string): string {
  const { year, month, day } = parseIsoDate(isoDate, "isoDate");
  const utc = new Date(Date.UTC(year, month - 1, day));
  const dayNum = utc.getUTCDay() || 7;
  utc.setUTCDate(utc.getUTCDate() + 4 - dayNum);
  const isoYear = utc.getUTCFullYear();
  const yearStart = new Date(Date.UTC(isoYear, 0, 1));
  const weekNo = Math.ceil(
    ((utc.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7,
  );
  return `${isoYear}-W${String(weekNo).padStart(2, "0")}`;
}

/**
 * Reduces dense histories (> maxPoints) to the last point per ISO week while
 * preserving gapBefore flags across each week.
 */
export function thinHistory(
  marked: readonly MarkedBalanceHistoryPoint[],
  maxPoints = HISTORY_MAX_POINTS,
): MarkedBalanceHistoryPoint[] {
  const safeMax = assertNonNegativeInteger(maxPoints, "maxPoints");
  if (marked.length <= safeMax) {
    return [...marked];
  }

  const weeks = new Map<string, MarkedBalanceHistoryPoint>();
  for (const point of marked) {
    const weekKey = getIsoWeekKey(point.date);
    const existing = weeks.get(weekKey);
    if (!existing) {
      weeks.set(weekKey, { ...point });
      continue;
    }
    const gapBefore = existing.gapBefore || point.gapBefore;
    const gapDays = point.gapDays ?? existing.gapDays;
    weeks.set(weekKey, {
      ...point,
      gapBefore,
      gapDays: gapBefore ? gapDays : null,
    });
  }

  return Array.from(weeks.values());
}

/**
 * Summarizes a marked (and optionally thinned) history slice.
 */
export function summarizeHistoryRange(
  points: readonly MarkedBalanceHistoryPoint[],
): HistoryRangeSummary {
  const count = points.length;
  const first = points[0] ?? null;
  const last = points[count - 1] ?? null;
  const netWorthDeltaCents =
    count >= 2 && first && last
      ? last.netWorthCents - first.netWorthCents
      : null;

  let gapCount = 0;
  let anyModeled = false;
  for (const point of points) {
    if (point.gapBefore) {
      gapCount += 1;
    }
    if (point.hasModeledValues) {
      anyModeled = true;
    }
  }

  return {
    count,
    first,
    last,
    netWorthDeltaCents,
    gapCount,
    anyModeled,
  };
}

/**
 * Computes component deltas between the current live balance and the first
 * historical point in the selected range. Returns null when no prior point exists.
 */
export function computeComponentDeltas(
  live: {
    freeAssetsCents: number;
    boundAssetsCents: number;
    liabilitiesCents: number;
  },
  firstInRange: BalanceHistoryPoint | null,
  todayIso: string,
): ComponentDeltas | null {
  parseIsoDate(todayIso, "todayIso");
  if (!firstInRange || firstInRange.date >= todayIso) {
    return null;
  }

  return {
    sinceDate: firstInRange.date,
    freeAssetsDeltaCents: live.freeAssetsCents - firstInRange.freeAssetsCents,
    boundAssetsDeltaCents:
      live.boundAssetsCents - firstInRange.boundAssetsCents,
    liabilitiesDeltaCents:
      live.liabilitiesCents - firstInRange.liabilitiesCents,
  };
}

/**
 * Selects the last available snapshot per calendar month, sorted descending,
 * capped at maxRows (default 12).
 */
export function selectMonthEndValues(
  points: readonly BalanceHistoryPoint[],
  maxRows = 12,
): MonthEndHistoryRow[] {
  const safeMax = assertNonNegativeInteger(maxRows, "maxRows");
  if (safeMax === 0 || points.length === 0) {
    return [];
  }

  const byMonth = new Map<string, BalanceHistoryPoint>();
  for (const point of points) {
    const month = toYearMonth(point.date);
    const existing = byMonth.get(month);
    if (!existing || point.date >= existing.date) {
      byMonth.set(month, point);
    }
  }

  return Array.from(byMonth.entries())
    .sort(([monthA], [monthB]) => monthB.localeCompare(monthA))
    .slice(0, safeMax)
    .map(([month, point]) => ({ month, point }));
}
