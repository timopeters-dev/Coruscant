"use client";

import { formatDateDE } from "@/lib/domain/date-format";
import * as React from "react";
import { ChartDataTable } from "@/components/charts/chart-data-table";
import { formatWholeEuroDE, pickDateTicks } from "@/components/charts/chart-scale";
import {
  LineChart,
  type LineChartAnchor,
  type LineChartMarker,
  type LineSeries,
} from "@/components/charts/line-chart";
import { StatusBadge } from "@/components/status-badge";
import type { FinancialContractRow } from "@/db/queries/contracts";
import {
  contractRecordToDomain,
  type ContractProjectionResult,
} from "@/lib/domain/contracts";
import {
  buildAmortizationSeries,
  effectiveAsOf,
} from "@/lib/domain/contract-series";
import { dayNumberToIsoDate, isoDateToDayNumber } from "@/lib/domain/date";
import { formatBpsDE } from "@/lib/domain/money";
import { AMORTIZATION_MARKER_LABELS, formatMonthYearDE } from "./labels";

interface SavingsProgressSectionProps {
  contract: FinancialContractRow;
  projection: ContractProjectionResult;
  asOfDate: string;
}

export function SavingsProgressSection({
  contract,
  projection,
  asOfDate,
}: SavingsProgressSectionProps) {
  const domainContract = React.useMemo(
    () => contractRecordToDomain(contract),
    [contract],
  );

  const safeAsOfDate = React.useMemo(
    () => effectiveAsOf(asOfDate, contract.balanceAsOfDate),
    [asOfDate, contract.balanceAsOfDate],
  );

  const series = React.useMemo(
    () => buildAmortizationSeries(domainContract, { asOfDate: safeAsOfDate }),
    [domainContract, safeAsOfDate],
  );

  const firstPoint = series.points[0]!;
  const lastPoint = series.points[series.points.length - 1]!;
  const firstDay = isoDateToDayNumber(firstPoint.date);
  const lastDay = isoDateToDayNumber(lastPoint.date);
  const xTicks = React.useMemo(
    () => pickDateTicks(firstDay, lastDay, 6, { variant: "projection" }),
    [firstDay, lastDay],
  );

  const chartSeries = React.useMemo<LineSeries[]>(() => {
    const result: LineSeries[] = [
      {
        id: "savings",
        label: "Guthaben",
        role: "bound",
        dashed: true,
        points: series.points.map((pt) => ({
          x: isoDateToDayNumber(pt.date),
          y: pt.balanceCents,
        })),
      },
    ];

    if (contract.targetSumCents != null && contract.targetSumCents > 0) {
      result.push({
        id: "target",
        label: "Zielsumme",
        role: "baseline",
        dashed: true,
        points: [
          { x: firstDay, y: contract.targetSumCents },
          { x: lastDay, y: contract.targetSumCents },
        ],
      });

      if (series.allocationThresholdCents !== null) {
        result.push({
          id: "threshold",
          label: "Zuteilungsschwelle",
          role: "milestone",
          dashed: true,
          points: [
            { x: firstDay, y: series.allocationThresholdCents },
            { x: lastDay, y: series.allocationThresholdCents },
          ],
        });
      }
    }

    return result;
  }, [
    series.points,
    series.allocationThresholdCents,
    contract.targetSumCents,
    firstDay,
    lastDay,
  ]);

  const anchors = React.useMemo<LineChartAnchor[]>(
    () => [
      {
        x: firstDay,
        y: firstPoint.balanceCents,
        label: `Geeicht ${formatDateDE(series.startDate)}`,
        role: "bound",
      },
    ],
    [firstDay, firstPoint.balanceCents, series.startDate],
  );

  const markers = React.useMemo<LineChartMarker[]>(() => {
    return series.markers
      .filter(
        (m) =>
          m.kind === "today" ||
          m.kind === "allocation_threshold" ||
          m.kind === "target_reached",
      )
      .map((m) => ({
        x: isoDateToDayNumber(m.date),
        label: AMORTIZATION_MARKER_LABELS[m.kind],
        role:
          m.kind === "target_reached"
            ? "free"
            : m.kind === "allocation_threshold"
              ? "milestone"
              : "axisText",
      }));
  }, [series.markers]);

  const dataTableRows = React.useMemo(() => {
    const lastIdx = series.points.length - 1;
    return series.points
      .filter(
        (pt, idx) =>
          pt.monthIndex === 0 || pt.monthIndex % 12 === 0 || idx === lastIdx,
      )
      .map((pt) => ({
        date: pt.date,
        balance: formatWholeEuroDE(pt.balanceCents),
      }));
  }, [series.points]);

  return (
    <section className="space-y-4 rounded-xl border border-[var(--border)] p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-[var(--text-primary)]">
          Bauspar-Verlauf
        </h3>
        <StatusBadge variant="modeled" label="Modelliert" />
      </div>

      {series.flags.notProjected ? (
        <p className="rounded-lg border border-dashed border-[var(--border)] px-3 py-2 text-xs text-[var(--text-secondary)]">
          {contract.status === "closed"
            ? "Beendet – keine Fortschreibung."
            : "Pausiert – keine Fortschreibung."}
        </p>
      ) : (
        <>
          <LineChart
            series={chartSeries}
            xDomain={[firstDay, lastDay]}
            xTicks={xTicks}
            xTooltipLabel={(x) => dayNumberToIsoDate(Math.round(x))}
            markers={markers}
            anchors={anchors}
            height={220}
            ariaLabel={`Bauspar-Verlauf für ${contract.name}`}
          />

          <ChartDataTable
            summary={`Jährliche Stützwerte anzeigen (${contract.name})`}
            columns={[
              { key: "date", header: "Datum" },
              { key: "balance", header: "Guthaben", align: "right" },
            ]}
            rows={dataTableRows}
          />

          <div className="grid gap-2.5 sm:grid-cols-3">
            <div className="rounded-lg border border-dashed border-[var(--border-sub)] bg-[var(--surface-elevated)]/30 p-3">
              <p className="text-2xs text-[var(--text-secondary)]">
                Fortschritt
              </p>
              <p className="mt-1 tabular-nums text-sm font-semibold text-[var(--text-primary)]">
                {projection.targetProgressBps != null
                  ? formatBpsDE(projection.targetProgressBps)
                  : "—"}
              </p>
            </div>
            <div className="rounded-lg border border-dashed border-[var(--border-sub)] bg-[var(--surface-elevated)]/30 p-3">
              <p className="text-2xs text-[var(--text-secondary)]">
                Zuteilungsschwelle ca.
              </p>
              <p className="mt-1 tabular-nums text-sm font-semibold text-[var(--text-primary)]">
                {series.allocationThresholdDate
                  ? formatMonthYearDE(series.allocationThresholdDate)
                  : "—"}
              </p>
            </div>
            <div className="rounded-lg border border-dashed border-[var(--border-sub)] bg-[var(--surface-elevated)]/30 p-3">
              <p className="text-2xs text-[var(--text-secondary)]">
                Zielsumme ca.
              </p>
              <p className="mt-1 tabular-nums text-sm font-semibold text-[var(--text-primary)]">
                {series.targetReachedDate
                  ? formatMonthYearDE(series.targetReachedDate)
                  : "—"}
              </p>
            </div>
          </div>

          <div className="space-y-1 text-xs text-[var(--text-secondary)]">
            {contract.targetSumCents == null || contract.targetSumCents === 0 ? (
              <p className="text-[var(--amber)]">
                Zielsumme im Vertrag hinterlegen.
              </p>
            ) : null}
            <p>
              Vereinfachte Schätzung; die tatsächliche Zuteilung hängt
              zusätzlich von der Bewertungszahl der Bausparkasse ab.
            </p>
          </div>
        </>
      )}
    </section>
  );
}
