"use client";

import * as React from "react";
import { ChevronDown, ChevronRight, RotateCcw } from "lucide-react";
import { ChartDataTable } from "@/components/charts/chart-data-table";
import { formatWholeEuroDE, pickDateTicks } from "@/components/charts/chart-scale";
import {
  LineChart,
  type LineChartAnchor,
  type LineChartMarker,
  type LineSeries,
} from "@/components/charts/line-chart";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import type { FinancialContractRow } from "@/db/queries/contracts";
import type { DomainContract } from "@/lib/domain/contracts";
import {
  buildAmortizationSeries,
  compareSpecialRepayment,
  effectiveAsOf,
} from "@/lib/domain/contract-series";
import {
  addMonthsToYearMonth,
  dayNumberToIsoDate,
  isoDateToDayNumber,
} from "@/lib/domain/date";
import { formatCentsDE } from "@/lib/domain/money";
import {
  AMORTIZATION_MARKER_LABELS,
  formatDurationMonthsDE,
  formatMonthYearDE,
} from "./labels";

interface LoanAmortizationSectionProps {
  contract: FinancialContractRow;
  asOfDate: string;
}

function toDomainContract(row: FinancialContractRow): DomainContract {
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    status: row.status,
    currentBalanceCents: row.currentBalanceCents,
    balanceAsOfDate: row.balanceAsOfDate,
    monthlyRateCents: row.monthlyRateCents,
    interestRateBps: row.interestRateBps,
    repaymentType: row.repaymentType,
    milestoneDate: row.milestoneDate,
    milestoneLabel: row.milestoneLabel,
    fixedInterestUntil: row.fixedInterestUntil,
    targetSumCents: row.targetSumCents,
    allocationThresholdPercent: row.allocationThresholdPercent,
    specialRepaymentMaxYearlyCents: row.specialRepaymentMaxYearlyCents,
  };
}

export function LoanAmortizationSection({
  contract,
  asOfDate,
}: LoanAmortizationSectionProps) {
  const domainContract = React.useMemo(
    () => toDomainContract(contract),
    [contract],
  );

  const safeAsOfDate = React.useMemo(
    () => effectiveAsOf(asOfDate, contract.balanceAsOfDate),
    [asOfDate, contract.balanceAsOfDate],
  );

  const minMonth = safeAsOfDate.slice(0, 7);
  const defaultSpecialMonth = React.useMemo(
    () => addMonthsToYearMonth(minMonth, 1),
    [minMonth],
  );

  const [simOpen, setSimOpen] = React.useState(false);
  const [amountEuros, setAmountEuros] = React.useState(0);
  const [specialMonth, setSpecialMonth] = React.useState(defaultSpecialMonth);
  const [repeatYearly, setRepeatYearly] = React.useState(false);

  const amountCents = Math.max(0, Math.round(amountEuros) * 100);
  const safeMonth = specialMonth >= minMonth ? specialMonth : minMonth;
  const specialDate = `${safeMonth}-01`;
  const effectiveSpecialDate =
    specialDate >= safeAsOfDate ? specialDate : safeAsOfDate;

  const isSpecialActive =
    contract.status === "active" && amountCents > 0;

  const comparison = React.useMemo(() => {
    if (!isSpecialActive) {
      return null;
    }
    return compareSpecialRepayment(domainContract, {
      asOfDate: safeAsOfDate,
      specialRepayment: {
        amountCents,
        date: effectiveSpecialDate,
        repeatYearly,
      },
    });
  }, [
    isSpecialActive,
    domainContract,
    safeAsOfDate,
    amountCents,
    effectiveSpecialDate,
    repeatYearly,
  ]);

  const baseline = React.useMemo(
    () =>
      comparison?.baseline ??
      buildAmortizationSeries(domainContract, { asOfDate: safeAsOfDate }),
    [comparison, domainContract, safeAsOfDate],
  );

  const maxSliderEuros = React.useMemo(() => {
    const cap = contract.specialRepaymentMaxYearlyCents;
    if (cap != null && cap > 0) {
      return Math.max(100, Math.round(cap / 100));
    }
    return Math.max(
      1000,
      Math.round(contract.currentBalanceCents / 100),
    );
  }, [contract.specialRepaymentMaxYearlyCents, contract.currentBalanceCents]);

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

    if (comparison) {
      result.push({
        id: "withSpecial",
        label: "Mit Sondertilgung",
        role: "scenario",
        dashed: true,
        points: comparison.withSpecial.points.map((pt) => ({
          x: isoDateToDayNumber(pt.date),
          y: pt.balanceCents,
        })),
      });
    }

    return result;
  }, [baseline, comparison]);

  const firstPoint = baseline.points[0]!;
  const lastPoint = baseline.points[baseline.points.length - 1]!;
  const firstDay = isoDateToDayNumber(firstPoint.date);
  const lastDay = isoDateToDayNumber(lastPoint.date);
  const xTicks = React.useMemo(
    () => pickDateTicks(firstDay, lastDay, 6),
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
    return baseline.markers
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
  }, [baseline.markers]);

  const dataTableRows = React.useMemo(() => {
    const withSpecMap = new Map<number, number>();
    if (comparison) {
      for (const pt of comparison.withSpecial.points) {
        withSpecMap.set(pt.monthIndex, pt.balanceCents);
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
        ...(comparison
          ? {
              withSpecial: formatWholeEuroDE(
                withSpecMap.get(pt.monthIndex) ?? 0,
              ),
            }
          : {}),
      }));
  }, [baseline.points, comparison]);

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
              comparison
                ? [
                    { key: "date", header: "Datum" },
                    { key: "baseline", header: "Restschuld", align: "right" },
                    {
                      key: "withSpecial",
                      header: "Mit Sondertilgung",
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

          {/* Progressive Disclosure: Special Repayment Simulator */}
          <div className="border-t border-[var(--border)] pt-3">
            <button
              type="button"
              onClick={() => setSimOpen((v) => !v)}
              aria-expanded={simOpen}
              className="flex w-full items-center justify-between text-left text-xs font-medium text-[var(--text-primary)] hover:text-[var(--accent)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
            >
              <span>Sondertilgung simulieren</span>
              {simOpen ? (
                <ChevronDown className="h-4 w-4" />
              ) : (
                <ChevronRight className="h-4 w-4" />
              )}
            </button>

            {simOpen ? (
              <div className="mt-3 space-y-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <label
                      htmlFor={`sr-amount-${contract.id}`}
                      className="block text-xs text-[var(--text-secondary)]"
                    >
                      Betrag (€)
                    </label>
                    <input
                      id={`sr-amount-${contract.id}`}
                      type="range"
                      min={0}
                      max={maxSliderEuros}
                      step={100}
                      value={Math.min(amountEuros, maxSliderEuros)}
                      onChange={(e) => setAmountEuros(Number(e.target.value))}
                      className="w-full accent-[var(--accent)]"
                    />
                    <input
                      type="number"
                      min={0}
                      step={100}
                      value={amountEuros}
                      onChange={(e) =>
                        setAmountEuros(Math.max(0, Number(e.target.value) || 0))
                      }
                      aria-label="Sondertilgung Betrag in Euro"
                      className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1.5 text-sm tabular-nums text-[var(--text-primary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label
                      htmlFor={`sr-month-${contract.id}`}
                      className="block text-xs text-[var(--text-secondary)]"
                    >
                      Monat
                    </label>
                    <input
                      id={`sr-month-${contract.id}`}
                      type="month"
                      min={minMonth}
                      value={safeMonth}
                      onChange={(e) => setSpecialMonth(e.target.value)}
                      className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1.5 text-sm tabular-nums text-[var(--text-primary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
                    />
                    <label className="flex items-center gap-2 pt-1 text-xs text-[var(--text-primary)]">
                      <input
                        type="checkbox"
                        checked={repeatYearly}
                        onChange={(e) => setRepeatYearly(e.target.checked)}
                        className="rounded border-[var(--border)] accent-[var(--accent)]"
                      />
                      jährlich wiederholen
                    </label>
                  </div>
                </div>

                <div className="flex items-center justify-between gap-2">
                  <p className="text-[11px] text-[var(--text-secondary)]">
                    Bereits geleistete Sondertilgungen dieses Jahres sind nicht
                    berücksichtigt.
                  </p>
                  {amountEuros > 0 ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setAmountEuros(0);
                        setSpecialMonth(defaultSpecialMonth);
                        setRepeatYearly(false);
                      }}
                    >
                      <RotateCcw className="mr-1 h-3.5 w-3.5" />
                      Zurücksetzen
                    </Button>
                  ) : null}
                </div>

                {comparison ? (
                  <div className="space-y-2 rounded-xl border border-dashed border-[var(--border-sub)] bg-[var(--surface-elevated)]/40 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-medium text-[var(--text-primary)]">
                        Simulierte Wirkung
                      </span>
                      <StatusBadge variant="modeled" label="Modelliert" />
                    </div>
                    <div className="space-y-1 text-xs tabular-nums text-[var(--text-primary)]">
                      {comparison.balanceAtFixedEndDeltaCents !== null ? (
                        <p>
                          Restschuld zum Zinsbindungsende{" "}
                          <span className="font-semibold text-[var(--emerald)]">
                            −{formatCentsDE(comparison.balanceAtFixedEndDeltaCents)}
                          </span>
                        </p>
                      ) : null}
                      {comparison.interestSavedUntilFixedEndCents !== null ? (
                        <p>
                          Gesparte Zinsen bis Zinsbindungsende{" "}
                          <span className="font-semibold text-[var(--emerald)]">
                            {formatCentsDE(
                              comparison.interestSavedUntilFixedEndCents,
                            )}
                          </span>{" "}
                          (gesamt {formatCentsDE(comparison.interestSavedTotalCents)})
                        </p>
                      ) : (
                        <p>
                          Gesparte Zinsen gesamt{" "}
                          <span className="font-semibold text-[var(--emerald)]">
                            {formatCentsDE(comparison.interestSavedTotalCents)}
                          </span>
                        </p>
                      )}
                      <p>
                        Laufzeit{" "}
                        {comparison.monthsSaved !== null ? (
                          <span className="font-semibold text-[var(--emerald)]">
                            −{formatDurationMonthsDE(comparison.monthsSaved)}
                          </span>
                        ) : (
                          "nicht absehbar"
                        )}
                      </p>
                    </div>

                    {/* Overflow / Edge Notices */}
                    <div className="space-y-1 pt-1 text-[11px] text-[var(--amber)]">
                      {comparison.withSpecial.special &&
                      comparison.withSpecial.special.capOverflowCents > 0 ? (
                        <p>
                          {formatCentsDE(
                            comparison.withSpecial.special.capOverflowCents,
                          )}{" "}
                          über dem Jahreslimit, nicht angerechnet.
                        </p>
                      ) : null}
                      {comparison.withSpecial.special &&
                      comparison.withSpecial.special.exceedsDebtCents > 0 ? (
                        <p>
                          {formatCentsDE(
                            comparison.withSpecial.special.exceedsDebtCents,
                          )}{" "}
                          über der Restschuld, nicht benötigt.
                        </p>
                      ) : null}
                      {comparison.withSpecial.special &&
                      comparison.withSpecial.special.afterPayoffIgnoredCents >
                        0 ? (
                        <p>
                          Zahlung nach Schuldenfreiheit (
                          {formatCentsDE(
                            comparison.withSpecial.special
                              .afterPayoffIgnoredCents,
                          )}
                          ) ignoriert.
                        </p>
                      ) : null}
                      {comparison.withSpecial.flags.capUnknown ? (
                        <p>Sondertilgungsrecht im Vertrag prüfen.</p>
                      ) : null}
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        </>
      )}
    </section>
  );
}
