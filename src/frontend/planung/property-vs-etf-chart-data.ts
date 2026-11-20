import { formatWholeEuroDE, type ChartTick } from "@/frontend/charts/chart-scale";
import type { ChartTooltipExtra } from "@/frontend/charts/chart-tooltip";
import type {
  LineChartMarker,
  LineSeries,
} from "@/frontend/charts/line-chart";
import type { PropertyVsEtfResult } from "@/domain/planning/property-vs-etf";

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
  /** Spalten der Wertetabelle (bei Überschuss-Depot eine mehr). */
  tableColumns: Array<{
    key: "year" | "property" | "propertyWithoutDepot" | "etf" | "advantage";
    header: string;
    align?: "right";
  }>;
  tableRows: Array<{
    year: string;
    property: string;
    propertyWithoutDepot?: string;
    etf: string;
    advantage: string;
  }>;
  /** Legendeneinträge in Serienreihenfolge. */
  legend: Array<{
    role: LineSeries["role"];
    dashed: true;
    shape: "line";
    label: string;
  }>;
  ariaLabel: string;
}

const LABEL_PROPERTY = "Immobilie (nach Verkauf)";
const LABEL_PROPERTY_WITH_DEPOT = "Immobilie mit Überschuss-Depot";
const LABEL_PROPERTY_WITHOUT_DEPOT = "Immobilie mit zinslosem Überschuss";
const LABEL_ETF = "ETF (nach Verkauf)";

/** Beschriftung für Screenreader; nennt die dritte Linie bei Überschuss-Depot. */
export function chartAriaLabel(result: PropertyVsEtfResult): string {
  const horizon = result.years.length - 1;
  return result.reinvestSurplus
    ? `Vermögen bei Verkauf: Immobilie mit Überschuss-Depot, Immobilie mit zinslosem Überschuss und ETF über ${horizon} Jahre`
    : `Vermögen bei Verkauf: Immobilie und ETF über ${horizon} Jahre`;
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
  const reinvest = result.reinvestSurplus;

  const series: LineSeries[] = [
    {
      id: "property",
      label: reinvest ? LABEL_PROPERTY_WITH_DEPOT : LABEL_PROPERTY,
      role: "bound",
      dashed: true,
      points: result.years.map((y) => ({
        x: y.year,
        y: y.propertyLiquidationCents,
      })),
    },
    ...(reinvest
      ? [
          {
            id: "propertyWithoutDepot",
            label: LABEL_PROPERTY_WITHOUT_DEPOT,
            role: "baseline" as const,
            dashed: true,
            points: result.years.map((y) => ({
              x: y.year,
              y: y.propertyLiquidationWithoutDepotCents,
            })),
          },
        ]
      : []),
    {
      id: "etf",
      label: LABEL_ETF,
      role: "optionB",
      dashed: true,
      points: result.years.map((y) => ({
        x: y.year,
        y: y.etfLiquidationCents,
      })),
    },
  ];

  return {
    series,
    legend: series.map((x) => ({
      role: x.role,
      dashed: true as const,
      shape: "line" as const,
      label: x.label,
    })),
    ariaLabel: chartAriaLabel(result),
    tableColumns: [
      { key: "year", header: "Jahr" },
      { key: "property", header: "Immobilie", align: "right" },
      ...(reinvest
        ? [
            {
              key: "propertyWithoutDepot" as const,
              header: "Immobilie mit zinslosem Überschuss",
              align: "right" as const,
            },
          ]
        : []),
      { key: "etf", header: "ETF", align: "right" },
      { key: "advantage", header: "Vorteil", align: "right" },
    ],
    xDomain: [0, horizon],
    xTicks: buildHorizonYearTicks(horizon),
    markers: buildMarkers(result),
    tooltipTitle: (year) =>
      year === 0 ? "Kauf (Jahr 0)" : `Verkauf Ende Jahr ${year}`,
    tooltipExtra: (year) => {
      const row = byYear(year);
      if (!row) return [];
      const extra: ChartTooltipExtra[] = [
        {
          label: "Vorteil Immobilie",
          value: formatWholeEuroDE(row.advantageCents, { showPlusSign: true }),
        },
      ];
      if (reinvest) {
        extra.push(
          {
            label: "Überschuss-Depot (nach Steuern)",
            value: formatWholeEuroDE(row.surplusDepotNetCents),
          },
          {
            label: "Immobilie mit zinslosem Überschuss",
            value: formatWholeEuroDE(row.propertyLiquidationWithoutDepotCents),
          },
        );
      }
      extra.push({
        label: "Bestand ohne Verkauf",
        value: `Immobilie ${formatWholeEuroDE(row.propertyNetWorthCents)} · ETF ${formatWholeEuroDE(row.etfValueCents)}`,
      });
      return extra;
    },
    tableRows: result.years.map((y) => ({
      year: yearLabel(y.year),
      property: formatWholeEuroDE(y.propertyLiquidationCents),
      ...(reinvest
        ? {
            propertyWithoutDepot: formatWholeEuroDE(
              y.propertyLiquidationWithoutDepotCents,
            ),
          }
        : {}),
      etf: formatWholeEuroDE(y.etfLiquidationCents),
      advantage: formatWholeEuroDE(y.advantageCents, { showPlusSign: true }),
    })),
  };
}

export interface PropertyVsEtfKpi {
  key: "property" | "etf" | "advantage" | "propertyWithoutDepot";
  label: string;
  value: string;
  tone: "bound" | "accent" | "positive" | "negative" | "neutral";
}

export function toPropertyVsEtfKpis(
  result: PropertyVsEtfResult,
): PropertyVsEtfKpi[] {
  const advantage = result.final.advantageCents;
  const kpis: PropertyVsEtfKpi[] = [
    {
      key: "property",
      label: result.reinvestSurplus
        ? "Immobilien-Vermögen inkl. Überschuss-Depot"
        : "Immobilien-Vermögen",
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
  if (result.reinvestSurplus) {
    kpis.push({
      key: "propertyWithoutDepot",
      label: "Immobilien-Vermögen mit zinslosem Überschuss",
      value: formatWholeEuroDE(result.final.propertyLiquidationWithoutDepotCents),
      tone: "neutral",
    });
  }
  return kpis;
}

export function describeKpiBasis(result: PropertyVsEtfResult): string {
  const horizon = result.years.length - 1;
  const base = result.taxesEnabled
    ? `Verkauf Ende Jahr ${horizon}, nach Verkaufskosten und Steuern`
    : `Verkauf Ende Jahr ${horizon}, nach Verkaufskosten, ohne Steuern`;
  return result.reinvestSurplus
    ? `${base}, inkl. Überschuss-Depot nach Steuern`
    : base;
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
