"use client";

import { formatMonthDE } from "@/domain/core/date-format";
import * as React from "react";
import { ChartDataTable } from "@/frontend/charts/chart-data-table";
import { ChartLegend } from "@/frontend/charts/chart-legend";
import { pickDateTicks } from "@/frontend/charts/chart-scale";
import { LineChart } from "@/frontend/charts/line-chart";
import { Sheet } from "@/frontend/ui/sheet";
import {
  selectMonthEndValues,
  type BalanceHistoryPoint,
  type HistoryRangeId,
  type HistoryRangeSummary,
  type MarkedBalanceHistoryPoint,
} from "@/domain/cockpit/balance-history";
import { isoDateToDayNumber } from "@/domain/core/date";
import { formatCentsDE } from "@/domain/core/money";
import {
  buildComponentSeries,
  formatHistoryDateLabel,
} from "./history-chart-data";
import { HISTORY_RANGE_OPTIONS } from "./history-range-switch";

interface BalanceHistoryDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  points: readonly MarkedBalanceHistoryPoint[];
  rawPoints?: readonly BalanceHistoryPoint[];
  summary: HistoryRangeSummary;
  range: HistoryRangeId;
  fromIso: string | null;
  todayIso: string;
}

function formatYearMonthDE(ym: string): string {
  return formatMonthDE(ym);
}

export function BalanceHistoryDrawer({
  open,
  onOpenChange,
  points,
  rawPoints,
  summary,
  range,
  fromIso,
  todayIso,
}: BalanceHistoryDrawerProps) {
  const series = React.useMemo(
    () => buildComponentSeries(points, summary.anyModeled),
    [points, summary.anyModeled],
  );

  const rangeLabel =
    HISTORY_RANGE_OPTIONS.find((opt) => opt.id === range)?.label ?? range;

  const toDay = isoDateToDayNumber(todayIso);
  const fromDay =
    fromIso !== null
      ? isoDateToDayNumber(fromIso)
      : summary.first
        ? isoDateToDayNumber(summary.first.date)
        : toDay;
  const xTicks = React.useMemo(
    () => pickDateTicks(fromDay, toDay, 6),
    [fromDay, toDay],
  );

  const monthRows = React.useMemo(
    () => selectMonthEndValues(rawPoints ?? points, 12),
    [rawPoints, points],
  );

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="Vermögensstruktur im Verlauf"
      subtitle={`Zeitraum: ${rangeLabel}`}
      className="max-w-2xl"
    >
      <div className="space-y-5">
        <LineChart
          series={series}
          xDomain={[fromDay, toDay]}
          xTicks={xTicks}
          xTooltipLabel={formatHistoryDateLabel}
          height={240}
          ariaLabel={`Verlauf Frei, Gebunden und Schulden, Zeitraum ${rangeLabel}`}
        />

        <ChartLegend
          items={[
            { label: "Frei (Ist)", role: "free", dashed: false },
            {
              label: summary.anyModeled
                ? "Gebunden (Modelliert)"
                : "Gebunden",
              role: "bound",
              dashed: summary.anyModeled,
            },
            {
              label: summary.anyModeled
                ? "Schulden (Modelliert)"
                : "Schulden",
              role: "liabilities",
              dashed: summary.anyModeled,
            },
          ]}
        />

        {monthRows.length > 0 ? (
          <ChartDataTable
            summary="Monatsendwerte anzeigen"
            columns={[
              { key: "month", header: "Monat" },
              { key: "free", header: "Frei", align: "right" },
              { key: "bound", header: "Gebunden", align: "right" },
              { key: "liabilities", header: "Schulden", align: "right" },
              { key: "net", header: "Netto", align: "right" },
            ]}
            rows={monthRows.map((row) => ({
              month: formatYearMonthDE(row.month),
              free: formatCentsDE(row.point.freeAssetsCents),
              bound: formatCentsDE(row.point.boundAssetsCents),
              liabilities: formatCentsDE(row.point.liabilitiesCents),
              net: (
                <span
                  className={
                    row.point.netWorthCents < 0
                      ? "text-[var(--rose)]"
                      : undefined
                  }
                >
                  {formatCentsDE(row.point.netWorthCents)}
                </span>
              ),
            }))}
          />
        ) : null}

        <p className="text-xs text-[var(--text-secondary)]">
          Gebunden = Immobilien-Schätzwert + Sparverträge (Modelliert). Werte
          werden täglich festgehalten, Lücken nicht aufgefüllt.
        </p>
      </div>
    </Sheet>
  );
}
