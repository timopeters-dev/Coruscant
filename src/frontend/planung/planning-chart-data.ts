import type { LineSeries } from "@/frontend/charts/line-chart";
import type { TimelineRow } from "@/frontend/charts/timeline-range-chart";
import type { CashflowChangeSeries } from "@/domain/allocation/cashflow-change-series";
import { addMonthsToYearMonth } from "@/domain/core/date";
import type {
  CashflowChangeResult,
  PrepaymentTimelinePoint,
} from "@/domain/planning/scenarios";
import { formatYearMonthDE } from "./format";

export function toPrepaymentSeries(
  timeline: readonly PrepaymentTimelinePoint[],
): LineSeries[] {
  if (timeline.length < 2) return [];

  const sampled = timeline.filter(
    (pt, idx) => pt.monthIndex % 12 === 0 || idx === timeline.length - 1,
  );

  return [
    {
      id: "prepayment",
      label: "Sondertilgung",
      role: "optionA",
      dashed: true,
      points: sampled.map((pt) => ({ x: pt.monthIndex, y: pt.netWorthA })),
    },
    {
      id: "etf",
      label: "ETF-Ansparung",
      role: "optionB",
      dashed: true,
      points: sampled.map((pt) => ({ x: pt.monthIndex, y: pt.netWorthB })),
    },
  ];
}

export function pickTimelineHorizonMonths(
  result: CashflowChangeResult,
  horizonMonths: number,
): number {
  let maxFill: number | null = null;
  for (const pot of result.pots) {
    if (!pot.hasTarget) continue;
    for (const m of [pot.baselineMonthsToFill, pot.scenarioMonthsToFill]) {
      if (m !== null && (maxFill === null || m > maxFill)) {
        maxFill = m;
      }
    }
  }
  if (maxFill === null) {
    return Math.min(horizonMonths, 60);
  }
  return Math.min(horizonMonths, Math.max(24, maxFill + 12));
}

export function toFillTimelineRows(
  result: CashflowChangeResult,
): TimelineRow[] {
  return result.pots
    .filter((p) => p.hasTarget)
    .map((p) => {
      if (p.alreadyFilled) {
        return {
          id: p.potId,
          label: p.potName,
          status: "filled" as const,
          from: 0,
          to: 0,
        };
      }
      const b = p.baselineMonthsToFill;
      const s = p.scenarioMonthsToFill;
      if (b !== null && s !== null) {
        return {
          id: p.potId,
          label: p.potName,
          status: "both" as const,
          from: b,
          to: s,
        };
      }
      if (b !== null) {
        return {
          id: p.potId,
          label: p.potName,
          status: "baseline_only" as const,
          from: b,
          to: null,
        };
      }
      if (s !== null) {
        return {
          id: p.potId,
          label: p.potName,
          status: "scenario_only" as const,
          from: null,
          to: s,
        };
      }
      return {
        id: p.potId,
        label: p.potName,
        status: "none" as const,
        from: null,
        to: null,
      };
    });
}

export function toSavingsSeries(
  series: CashflowChangeSeries,
  horizon: number,
): LineSeries[] {
  const maxT = Math.min(horizon, series.horizonMonths);
  if (maxT < 1) return [];

  const step = maxT > 120 ? 3 : 1;
  const indices: number[] = [];
  for (let t = 0; t <= maxT; t += step) {
    indices.push(t);
  }
  if (indices[indices.length - 1] !== maxT) {
    indices.push(maxT);
  }

  return [
    {
      id: "baseline",
      label: "heute",
      role: "baseline",
      dashed: true,
      points: indices.map((t) => ({ x: t, y: series.baseline.totalCents[t] ?? 0 })),
    },
    {
      id: "scenario",
      label: "mit Änderung",
      role: "scenario",
      dashed: true,
      points: indices.map((t) => ({ x: t, y: series.scenario.totalCents[t] ?? 0 })),
    },
  ];
}

export function xLabelForMonthIndex(startMonth: string, t: number): string {
  if (t <= 0) return "heute";
  return formatYearMonthDE(addMonthsToYearMonth(startMonth, t - 1));
}
