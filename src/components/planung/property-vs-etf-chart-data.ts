import { formatWholeEuroDE, type ChartTick } from "@/components/charts/chart-scale";
import type { ChartTooltipExtra } from "@/components/charts/chart-tooltip";
import type {
  LineChartMarker,
  LineSeries,
} from "@/components/charts/line-chart";
import type { PropertyVsEtfResult } from "@/lib/domain/property-vs-etf";

/**
 * Reiner Adapter: formatiert und ordnet ausschließlich Werte aus
 * `simulatePropertyVsEtf`. Es wird nichts gerechnet.
 */

const TICK_STEPS = [1, 2, 5, 10] as const;
const MAX_TICKS = 8;

function yearLabel(year: number): string {
  return year === 0 ? "Kauf" : `${year} J.`;
}

function buildTicksForStep(horizonYears: number, step: number): ChartTick[] {
  const ticks: ChartTick[] = [];
  for (let year = 0; year <= horizonYears; year += step) {
    ticks.push({ x: year, label: yearLabel(year) });
  }
  const last = ticks[ticks.length - 1];
  if (last && last.x !== horizonYears) {
    if (horizonYears - last.x < step / 2 && ticks.length > 1) {
      ticks.pop();
    }
    ticks.push({ x: horizonYears, label: yearLabel(horizonYears) });
  }
  return ticks;
}

/** Jahres-Ticks: kleinste Schrittweite aus 1/2/5/10 mit höchstens 8 Ticks; H immer enthalten. */
export function buildHorizonYearTicks(horizonYears: number): ChartTick[] {
  for (const step of TICK_STEPS) {
    const ticks = buildTicksForStep(horizonYears, step);
    if (ticks.length <= MAX_TICKS) return ticks;
  }
  return buildTicksForStep(horizonYears, 10);
}

export interface PropertyVsEtfChartModel {
  series: LineSeries[];
  xDomain: [number, number];
  xTicks: ChartTick[];
  markers: LineChartMarker[];
  tooltipTitle: (year: number) => string;
  tooltipExtra: (year: number) => ChartTooltipExtra[];
  tableRows: Array<{
    year: string;
    property: string;
    etf: string;
    advantage: string;
  }>;
}

function buildMarkers(result: PropertyVsEtfResult): LineChartMarker[] {
  const horizon = result.years.length - 1;
  const breakEven =
    result.breakEven.kind === "year" ? result.breakEven.year : null;
  const speculation =
    result.speculationFreeFromYear !== null &&
    result.speculationFreeFromYear >= 1 &&
    result.speculationFreeFromYear <= horizon
      ? result.speculationFreeFromYear
      : null;

  if (breakEven !== null && speculation !== null && breakEven === speculation) {
    return [
      {
        x: breakEven,
        label: "Break-even · § 23 steuerfrei",
        role: "milestone",
      },
    ];
  }

  const markers: LineChartMarker[] = [];
  if (breakEven !== null) {
    markers.push({ x: breakEven, label: "Break-even", role: "milestone" });
  }
  if (speculation !== null) {
    const adjacent = breakEven !== null && Math.abs(breakEven - speculation) === 1;
    markers.push({
      x: speculation,
      label: adjacent ? "§ 23" : "§ 23 steuerfrei",
      role: "baseline",
    });
  }
  return markers;
}

export function toPropertyVsEtfChart(
  result: PropertyVsEtfResult,
): PropertyVsEtfChartModel {
  const horizon = result.years.length - 1;
  const byYear = (year: number) => result.years[year];

  return {
    series: [
      {
        id: "property",
        label: "Immobilie (nach Verkauf)",
        role: "bound",
        dashed: true,
        points: result.years.map((y) => ({
          x: y.year,
          y: y.propertyLiquidationCents,
        })),
      },
      {
        id: "etf",
        label: "ETF (nach Verkauf)",
        role: "optionB",
        dashed: true,
        points: result.years.map((y) => ({
          x: y.year,
          y: y.etfLiquidationCents,
        })),
      },
    ],
    xDomain: [0, horizon],
    xTicks: buildHorizonYearTicks(horizon),
    markers: buildMarkers(result),
    tooltipTitle: (year) =>
      year === 0 ? "Kauf (Jahr 0)" : `Verkauf Ende Jahr ${year}`,
    tooltipExtra: (year) => {
      const row = byYear(year);
      if (!row) return [];
      return [
        {
          label: "Vorteil Immobilie",
          value: formatWholeEuroDE(row.advantageCents, { showPlusSign: true }),
        },
        {
          label: "Bestand ohne Verkauf",
          value: `Immobilie ${formatWholeEuroDE(row.propertyNetWorthCents)} · ETF ${formatWholeEuroDE(row.etfValueCents)}`,
        },
      ];
    },
    tableRows: result.years.map((y) => ({
      year: yearLabel(y.year),
      property: formatWholeEuroDE(y.propertyLiquidationCents),
      etf: formatWholeEuroDE(y.etfLiquidationCents),
      advantage: formatWholeEuroDE(y.advantageCents, { showPlusSign: true }),
    })),
  };
}

export interface PropertyVsEtfKpi {
  key: "property" | "etf" | "advantage";
  label: string;
  value: string;
  tone: "bound" | "accent" | "positive" | "negative" | "neutral";
}

export function toPropertyVsEtfKpis(
  result: PropertyVsEtfResult,
): PropertyVsEtfKpi[] {
  const advantage = result.final.advantageCents;
  return [
    {
      key: "property",
      label: "Immobilien-Vermögen",
      value: formatWholeEuroDE(result.final.propertyLiquidationCents),
      tone: "bound",
    },
    {
      key: "etf",
      label: "ETF-Vermögen",
      value: formatWholeEuroDE(result.final.etfLiquidationCents),
      tone: "accent",
    },
    {
      key: "advantage",
      label: "Immobilien-Vorteil",
      value: formatWholeEuroDE(advantage, { showPlusSign: true }),
      tone: advantage > 0 ? "positive" : advantage < 0 ? "negative" : "neutral",
    },
  ];
}

export function describeKpiBasis(result: PropertyVsEtfResult): string {
  const horizon = result.years.length - 1;
  return result.taxesEnabled
    ? `Verkauf Ende Jahr ${horizon}, nach Verkaufskosten und Steuern`
    : `Verkauf Ende Jahr ${horizon}, nach Verkaufskosten, ohne Steuern`;
}

export function describeBreakEven(result: PropertyVsEtfResult): string {
  const horizon = result.years.length - 1;
  if (result.breakEven.kind === "never") {
    return `Innerhalb von ${horizon} Jahren liegt der ETF durchgehend vorn.`;
  }
  const year = result.breakEven.year;
  if (!result.leadsAtHorizon) {
    return `Immobilie liegt ab Jahr ${year} vorn, fällt bis Jahr ${horizon} aber wieder zurück.`;
  }
  return year === 0
    ? "Immobilie liegt von Anfang an vorn."
    : `Immobilie liegt ab Jahr ${year} vorn.`;
}

export function describeInitialCashflow(result: PropertyVsEtfResult): string {
  const afterTax = formatWholeEuroDE(result.initialMonthlyCashflowCents, {
    showPlusSign: true,
  });
  if (!result.taxesEnabled) {
    return `Monatlicher Cashflow im 1. Monat: ${afterTax}`;
  }
  const beforeTax = formatWholeEuroDE(
    result.initialMonthlyCashflowBeforeTaxCents,
    { showPlusSign: true },
  );
  return `Monatlicher Cashflow im 1. Monat: ${afterTax} nach Steuern (vor Steuern ${beforeTax})`;
}

export function describeFinancing(result: PropertyVsEtfResult): string {
  return `Kaltmiete ${formatWholeEuroDE(result.initialMonthlyColdRentCents)} / Monat · Darlehen ${formatWholeEuroDE(result.loanPrincipalCents)} · Rate ${formatWholeEuroDE(result.monthlyLoanRateCents)}`;
}
