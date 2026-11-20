"use client";

import * as React from "react";
import { ChartDataTable } from "@/frontend/charts/chart-data-table";
import {
  formatWholeEuroDE,
  pickDateTicks,
} from "@/frontend/charts/chart-scale";
import {
  LineChart,
  type LineChartMarker,
  type LineSeries,
} from "@/frontend/charts/line-chart";
import {
  type AmortizationSeriesResult,
  summarizeYearlyPaymentSplit,
} from "@/domain/contracts/series";
import { dayNumberToIsoDate, isoDateToDayNumber } from "@/domain/core/date";
import { AMORTIZATION_MARKER_LABELS, formatMonthYearDE } from "./labels";
import { Collapse, CollapseChevron } from "@/frontend/ui/collapse";

interface PaymentSplitSectionProps {
  contractName: string;
  baseline: AmortizationSeriesResult;
  adjusted?: AmortizationSeriesResult | null;
  defaultOpen?: boolean;
}

export function PaymentSplitSection({
  contractName,
  baseline,
  adjusted = null,
  defaultOpen = false,
}: PaymentSplitSectionProps) {
  const [open, setOpen] = React.useState(defaultOpen);

  const baselineMonthly = React.useMemo(
    () => baseline.points.filter((pt) => pt.monthIndex > 0),
    [baseline.points],
  );
  const adjustedMonthly = React.useMemo(
    () => (adjusted ? adjusted.points.filter((pt) => pt.monthIndex > 0) : []),
    [adjusted],
  );

  const baselineSplit = React.useMemo(
    () => summarizeYearlyPaymentSplit(baseline.points),
    [baseline.points],
  );
  const adjustedSplit = React.useMemo(
    () => (adjusted ? summarizeYearlyPaymentSplit(adjusted.points) : null),
    [adjusted],
  );

  const displaySplit = adjustedSplit ?? baselineSplit;

  const { series, xDomain, xTicks, markers } = React.useMemo(() => {
    const nextSeries: LineSeries[] = [];
    if (baselineMonthly.length >= 2) {
      nextSeries.push(
        {
          id: "interest",
          label: "Zinsanteil",
          role: "liabilities",
          dashed: false,
          points: baselineMonthly.map((pt) => ({
            x: isoDateToDayNumber(pt.date),
            y: pt.interestCents,
          })),
        },
        {
          id: "principal",
          label: "Tilgungsanteil",
          role: "free",
          dashed: false,
          points: baselineMonthly.map((pt) => ({
            x: isoDateToDayNumber(pt.date),
            y: pt.principalCents,
          })),
        },
      );
    }

    if (adjustedMonthly.length >= 2) {
      nextSeries.push(
        {
          id: "adjustedInterest",
          label: "Zinsanteil (Szenario)",
          role: "liabilities",
          dashed: true,
          points: adjustedMonthly.map((pt) => ({
            x: isoDateToDayNumber(pt.date),
            y: pt.interestCents,
          })),
        },
        {
          id: "adjustedPrincipal",
          label: "Tilgungsanteil (Szenario)",
          role: "free",
          dashed: true,
          points: adjustedMonthly.map((pt) => ({
            x: isoDateToDayNumber(pt.date),
            y: pt.principalCents,
          })),
        },
      );
    }

    const firstDay =
      baselineMonthly.length > 0
        ? isoDateToDayNumber(baselineMonthly[0]!.date)
        : 0;
    const lastDay =
      baselineMonthly.length > 0
        ? isoDateToDayNumber(baselineMonthly[baselineMonthly.length - 1]!.date)
        : 0;

    const nextTicks =
      baselineMonthly.length >= 2
        ? pickDateTicks(firstDay, lastDay, 6, { variant: "projection" })
        : [];

    const nextMarkers: LineChartMarker[] = [];
    const activeCrossover = adjustedSplit
      ? adjustedSplit.crossoverDate
      : baselineSplit.crossoverDate;
    if (activeCrossover) {
      nextMarkers.push({
        x: isoDateToDayNumber(activeCrossover),
        label: `Ab ${formatMonthYearDE(activeCrossover)} mehr Tilgung als Zins`,
        role: "free",
      });
    }
    const rateChangeMarker = adjusted?.markers.find(
      (m) => m.kind === "rate_change",
    );
    if (rateChangeMarker) {
      nextMarkers.push({
        x: isoDateToDayNumber(rateChangeMarker.date),
        label: AMORTIZATION_MARKER_LABELS.rate_change,
        role: "milestone",
      });
    }

    return {
      series: nextSeries,
      xDomain: [firstDay, lastDay] as [number, number],
      xTicks: nextTicks,
      markers: nextMarkers,
    };
  }, [baselineMonthly, adjustedMonthly, baselineSplit, adjustedSplit, adjusted]);

  const hasSpecialColumn = React.useMemo(
    () => displaySplit.rows.some((r) => r.specialCents > 0),
    [displaySplit.rows],
  );

  const tableRows = React.useMemo(
    () =>
      displaySplit.rows.map((row) => ({
        year: String(row.year),
        interest: formatWholeEuroDE(row.interestCents),
        principal: formatWholeEuroDE(row.principalCents),
        ...(hasSpecialColumn
          ? { special: formatWholeEuroDE(row.specialCents) }
          : {}),
        endBalance: formatWholeEuroDE(row.endBalanceCents),
      })),
    [displaySplit.rows, hasSpecialColumn],
  );

  return (
    <div className="border-t border-[var(--border)] pt-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between text-left text-xs font-medium text-[var(--text-primary)] hover:text-[var(--accent)] outline-hidden focus-visible:ring-[3px] focus-visible:ring-[var(--focus)]"
      >
        <span>Wie sich die Rate zusammensetzt</span>
        <CollapseChevron open={open} className="h-4 w-4" />
      </button>

      <Collapse open={open}>
        <div className="mt-3 space-y-3">
          {baseline.flags.lumpSum ? (
            <p className="text-xs text-[var(--text-secondary)]">
              Endfälliges Darlehen: Monatliche Zahlungen bestehen vollständig aus
              Zinsen, die Tilgung erfolgt am Laufzeitende.
            </p>
          ) : null}

          {displaySplit.crossoverDate ? (
            <p className="text-xs text-[var(--text-secondary)]">
              Ab{" "}
              <span className="tabular-nums font-medium text-[var(--emerald)]">
                {formatMonthYearDE(displaySplit.crossoverDate)}
              </span>{" "}
              fließt mehr in die Tilgung als in Zinsen.
            </p>
          ) : !baseline.flags.lumpSum && baselineMonthly.length >= 2 ? (
            <p className="text-xs text-[var(--text-secondary)]">
              Im dargestellten Zeitraum übersteigt der Tilgungsanteil den
              Zinsanteil nicht.
            </p>
          ) : null}

          <LineChart
            series={series}
            xDomain={xDomain}
            xTicks={xTicks}
            xTooltipLabel={(x) => formatMonthYearDE(dayNumberToIsoDate(Math.round(x)))}
            markers={markers}
            height={190}
            ariaLabel={`Zins- und Tilgungsanteil für ${contractName}`}
            emptyText="Nicht genügend Monatswerte für die Aufteilung vorhanden."
          />

          {tableRows.length > 0 ? (
            <ChartDataTable
              summary={`Jahreswerte Zins und Tilgung anzeigen (${contractName})`}
              columns={[
                { key: "year", header: "Jahr" },
                { key: "interest", header: "Zinsen", align: "right" },
                { key: "principal", header: "Tilgung", align: "right" },
                ...(hasSpecialColumn
                  ? [
                      {
                        key: "special",
                        header: "Sondertilgung",
                        align: "right" as const,
                      },
                    ]
                  : []),
                { key: "endBalance", header: "Restschuld", align: "right" },
              ]}
              rows={tableRows}
            />
          ) : null}
        </div>
      </Collapse>
    </div>
  );
}
