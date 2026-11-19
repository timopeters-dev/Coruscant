"use client";

import * as React from "react";
import { ChartDataTable } from "@/components/charts/chart-data-table";
import {
  formatWholeEuroDE,
  pickDateTicks,
} from "@/components/charts/chart-scale";
import {
  LineChart,
  type LineChartAnchor,
  type LineChartMarker,
  type LineSeries,
} from "@/components/charts/line-chart";
import { StatusBadge } from "@/components/status-badge";
import type { FinancialContractRow } from "@/db/queries/contracts";
import { contractRecordToDomain } from "@/lib/domain/contracts";
import {
  buildAmortizationSeries,
  effectiveAsOf,
  type LoanAdjustmentEffect,
} from "@/lib/domain/contract-series";
import { dayNumberToIsoDate, isoDateToDayNumber } from "@/lib/domain/date";
import { formatCentsDE } from "@/lib/domain/money";
import { AMORTIZATION_MARKER_LABELS, formatMonthYearDE } from "./labels";
import { LoanAdjustmentSimulator } from "./loan-adjustment-simulator";
import { PaymentSplitSection } from "./payment-split-section";

interface LoanAmortizationSectionProps {
  contract: FinancialContractRow;
  asOfDate: string;
  defaultSimulatorOpen?: boolean;
  defaultSplitOpen?: boolean;
}

export function LoanAmortizationSection({
  contract,
  asOfDate,
  defaultSimulatorOpen = false,
  defaultSplitOpen = false,
}: LoanAmortizationSectionProps) {
  const domainContract = React.useMemo(
    () => contractRecordToDomain(contract),
    [contract],
  );

  const safeAsOfDate = React.useMemo(
    () => effectiveAsOf(asOfDate, contract.balanceAsOfDate),
    [asOfDate, contract.balanceAsOfDate],
  );

  const [effect, setEffect] = React.useState<LoanAdjustmentEffect | null>(null);

  const baseline = React.useMemo(
    () =>
      effect?.baseline ??
      buildAmortizationSeries(domainContract, { asOfDate: safeAsOfDate }),
    [effect, domainContract, safeAsOfDate],
  );

  const chartSeries = React.useMemo<LineSeries[]>(() => {
    const beforeFixed: { x: number; y: number }[] = [];
    const afterFixed: { x: number; y: number }[] = [];

    for (const pt of baseline.points) {
      const xy = { x: isoDateToDayNumber(pt.date), y: pt.balanceCents };
      if (!pt.afterFixedInterestEnd) {
        beforeFixed.push(xy);
      } else {
        if (afterFixed.length === 0 && beforeFixed.length > 0) {
          afterFixed.push(beforeFixed[beforeFixed.length - 1]!);
        }
        afterFixed.push(xy);
      }
    }

    const result: LineSeries[] = [];
    if (beforeFixed.length >= 2) {
      result.push({
        id: "baseline",
        label: "Restschuld",
        role: "liabilities",
        dashed: true,
        points: beforeFixed,
      });
    } else if (afterFixed.length >= 2 && beforeFixed.length === 1) {
      // Edge case: fixedInterestUntil == startDate
      result.push({
        id: "afterFixed",
        label: "Restschuld nach Zinsbindung (Annahme gleicher Zins)",
        role: "baseline",
        dashed: true,
        points: afterFixed,
      });
    }

    if (beforeFixed.length >= 2 && afterFixed.length >= 2) {
      result.push({
        id: "afterFixed",
        label: "Restschuld nach Zinsbindung (Annahme gleicher Zins)",
        role: "baseline",
        dashed: true,
        points: afterFixed,
      });
    }

    if (effect) {
      result.push({
        id: "adjusted",
        label: "Mit Anpassung",
        role: "scenario",
        dashed: true,
        points: effect.adjusted.points.map((pt) => ({
          x: isoDateToDayNumber(pt.date),
          y: pt.balanceCents,
        })),
      });
    }

    return result;
  }, [baseline, effect]);

  const firstPoint = baseline.points[0]!;
  const lastPoint = baseline.points[baseline.points.length - 1]!;
  const firstDay = isoDateToDayNumber(firstPoint.date);
  const lastDay = isoDateToDayNumber(lastPoint.date);
  const xTicks = React.useMemo(
    () => pickDateTicks(firstDay, lastDay, 6, { variant: "projection" }),
    [firstDay, lastDay],
  );

  const anchors = React.useMemo<LineChartAnchor[]>(
    () => [
      {
        x: firstDay,
        y: firstPoint.balanceCents,
        label: `Geeicht ${baseline.startDate}`,
        role: "liabilities",
      },
    ],
    [firstDay, firstPoint.balanceCents, baseline.startDate],
  );

  const markers = React.useMemo<LineChartMarker[]>(() => {
    const baseMarkers: LineChartMarker[] = baseline.markers
      .filter(
        (m) =>
          m.kind === "today" ||
          m.kind === "fixed_interest_end" ||
          m.kind === "milestone" ||
          m.kind === "paid_off",
      )
      .map((m) => ({
        x: isoDateToDayNumber(m.date),
        label:
          m.kind === "milestone"
            ? m.label
            : AMORTIZATION_MARKER_LABELS[m.kind],
        role:
          m.kind === "paid_off"
            ? "free"
            : m.kind === "fixed_interest_end" || m.kind === "milestone"
              ? "milestone"
              : "axisText",
      }));

    const rateChangeMarker = effect?.adjusted.markers.find(
      (m) => m.kind === "rate_change",
    );
    if (rateChangeMarker) {
      baseMarkers.push({
        x: isoDateToDayNumber(rateChangeMarker.date),
        label: AMORTIZATION_MARKER_LABELS.rate_change,
        role: "scenario",
      });
    }

    return baseMarkers;
  }, [baseline.markers, effect]);

  const dataTableRows = React.useMemo(() => {
    const adjustedMap = new Map<number, number>();
    if (effect) {
      for (const pt of effect.adjusted.points) {
        adjustedMap.set(pt.monthIndex, pt.balanceCents);
      }
    }
    const lastIdx = baseline.points.length - 1;
    return baseline.points
      .filter(
        (pt, idx) =>
          pt.monthIndex === 0 || pt.monthIndex % 12 === 0 || idx === lastIdx,
      )
      .map((pt) => ({
        date: pt.date,
        baseline: formatWholeEuroDE(pt.balanceCents),
        ...(effect
          ? {
              adjusted: formatWholeEuroDE(adjustedMap.get(pt.monthIndex) ?? 0),
            }
          : {}),
      }));
  }, [baseline.points, effect]);

  const showFixedTiles =
    !baseline.flags.notProjected &&
    !baseline.flags.missingFixedInterestEnd &&
    baseline.balanceAtFixedInterestEndCents !== null;

  return (
    <section className="space-y-4 rounded-xl border border-[var(--border)] p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-[var(--text-primary)]">
          Tilgungsverlauf
        </h3>
        <StatusBadge variant="modeled" label="Modelliert" />
      </div>

      {baseline.flags.notProjected ? (
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
            ariaLabel={`Tilgungsverlauf für ${contract.name}`}
          />

          <ChartDataTable
            summary={`Jährliche Stützwerte anzeigen (${contract.name})`}
            columns={
              effect
                ? [
                    { key: "date", header: "Datum" },
                    { key: "baseline", header: "Restschuld", align: "right" },
                    {
                      key: "adjusted",
                      header: "Mit Anpassung",
                      align: "right",
                    },
                  ]
                : [
                    { key: "date", header: "Datum" },
                    { key: "baseline", header: "Restschuld", align: "right" },
                  ]
            }
            rows={dataTableRows}
          />

          {/* 3 KPI tiles */}
          <div className="grid gap-2.5 sm:grid-cols-3">
            {showFixedTiles ? (
              <>
                <div className="rounded-lg border border-dashed border-[var(--border-sub)] bg-[var(--surface-elevated)]/30 p-3">
                  <p className="text-[11px] text-[var(--text-secondary)]">
                    Restschuld zum Zinsbindungsende
                  </p>
                  <p className="mt-1 tabular-nums text-sm font-semibold text-[var(--text-primary)]">
                    {formatCentsDE(baseline.balanceAtFixedInterestEndCents!)}
                  </p>
                </div>
                <div className="rounded-lg border border-dashed border-[var(--border-sub)] bg-[var(--surface-elevated)]/30 p-3">
                  <p className="text-[11px] text-[var(--text-secondary)]">
                    Zinsen bis Zinsbindungsende
                  </p>
                  <p className="mt-1 tabular-nums text-sm font-semibold text-[var(--text-primary)]">
                    {formatCentsDE(baseline.interestUntilFixedEndCents ?? 0)}
                  </p>
                </div>
              </>
            ) : null}

            <div className="rounded-lg border border-dashed border-[var(--border-sub)] bg-[var(--surface-elevated)]/30 p-3">
              <p className="text-[11px] text-[var(--text-secondary)]">
                Schuldenfrei ca.
              </p>
              <p className="mt-1 tabular-nums text-sm font-semibold text-[var(--text-primary)]">
                {baseline.flags.lumpSum
                  ? "Endfällig"
                  : baseline.paidOffDate
                    ? formatMonthYearDE(baseline.paidOffDate)
                    : "nicht absehbar (> 40 Jahre)"}
              </p>
            </div>
          </div>

          {/* Notices */}
          <div className="space-y-1.5 text-xs text-[var(--text-secondary)]">
            {baseline.flags.lumpSum ? (
              <p>Endfällig: Tilgung am Laufzeitende, monatlich nur Zinsen.</p>
            ) : null}
            {!baseline.flags.lumpSum && baseline.flags.neverPaysOff ? (
              <p className="font-medium text-[var(--amber)]">
                Mit dieser Rate sinkt die Restschuld nicht.
              </p>
            ) : null}
            {baseline.flags.missingFixedInterestEnd ? (
              <p>
                Kein Zinsbindungsende hinterlegt, Kennzahlen bis
                Schuldenfreiheit.
              </p>
            ) : null}
            {baseline.flags.assumesSameRateAfterFixedEnd ? (
              <p>Annahme: gleicher Zins nach Zinsbindung.</p>
            ) : null}
          </div>

          <LoanAdjustmentSimulator
            contract={domainContract}
            asOfDate={safeAsOfDate}
            defaultOpen={defaultSimulatorOpen}
            onEffectChange={setEffect}
          />

          <PaymentSplitSection
            contractName={contract.name}
            baseline={baseline}
            adjusted={effect?.adjusted ?? null}
            defaultOpen={defaultSplitOpen}
          />
        </>
      )}
    </section>
  );
}
