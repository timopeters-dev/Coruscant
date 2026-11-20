"use client";

import * as React from "react";
import Link from "next/link";
import { ChartDataTable } from "@/frontend/charts/chart-data-table";
import { ChartLegend } from "@/frontend/charts/chart-legend";
import { formatWholeEuroDE, pickYearTicks } from "@/frontend/charts/chart-scale";
import { LineChart } from "@/frontend/charts/line-chart";
import { TimelineRangeChart } from "@/frontend/charts/timeline-range-chart";
import { StatusBadge } from "@/frontend/ui/status-badge";
import { simulateCashflowChangeSeries } from "@/domain/allocation/cashflow-change-series";
import { parseYearMonth } from "@/domain/core/date";
import type { DomainPot } from "@/domain/allocation/waterfall";
import { SliderField } from "./euro-slider-field";
import { formatYearMonthDE } from "./format";
import {
  pickTimelineHorizonMonths,
  toFillTimelineRows,
  toSavingsSeries,
  xLabelForMonthIndex,
} from "./planning-chart-data";
import { buildSalaryHeadlines } from "./planning-headlines";
import { PlanningPanelLayout } from "./planning-panel-layout";
import {
  DEFAULT_SALARY_HORIZON_YEARS,
  MAX_SALARY_HORIZON_YEARS,
  deriveSalaryView,
  isSalaryAdvancedModified,
  type SalaryAction,
  type SalaryState,
} from "./planning-state";
import { MonthPicker } from "@/frontend/ui/date-picker";

interface SalaryPanelProps {
  state: SalaryState;
  dispatch: React.Dispatch<SalaryAction>;
  baseSurplusCents: number;
  hasHouseholdData: boolean;
  isDummy: boolean;
  pots: DomainPot[];
  startMonth: string;
}

function gainLabel(gained: number | null): string {
  if (gained === null) return "–";
  if (gained === 0) return "unverändert";
  const n = Math.abs(gained);
  return `${n} ${n === 1 ? "Monat" : "Monate"} ${gained > 0 ? "früher" : "später"}`;
}

function effectiveFromIndex(startMonth: string, fromMonth: string): number {
  if (fromMonth <= startMonth) return 0;
  try {
    const s = parseYearMonth(startMonth, "startMonth");
    const f = parseYearMonth(fromMonth, "fromMonth");
    return Math.max(1, (f.year - s.year) * 12 + (f.month - s.month) + 1);
  } catch {
    return 0;
  }
}

export function SalaryPanel({
  state,
  dispatch,
  baseSurplusCents,
  hasHouseholdData,
  isDummy,
  pots,
  startMonth,
}: SalaryPanelProps) {
  const deferred = React.useDeferredValue(state);
  const isStale = state !== deferred;
  const [savingsOpen, setSavingsOpen] = React.useState(false);

  const view = React.useMemo(
    () =>
      deriveSalaryView(deferred, {
        baseSurplusCents,
        pots,
        startMonth,
      }),
    [deferred, baseSurplusCents, pots, startMonth],
  );

  const chartHorizon =
    view.kind === "ok"
      ? view.targetPotCount > 0
        ? pickTimelineHorizonMonths(view.result, view.result.horizonMonths)
        : Math.min(view.result.horizonMonths, 60)
      : 60;

  const savingsSeries = React.useMemo(() => {
    if (!savingsOpen || view.kind !== "ok") return null;
    try {
      return simulateCashflowChangeSeries({
        ...view.input,
        horizonMonths: chartHorizon,
      });
    } catch {
      return null;
    }
  }, [savingsOpen, view, chartHorizon]);

  const headlines = buildSalaryHeadlines(view, startMonth);

  const controls =
    pots.length === 0 ? (
      <p className="text-sm text-[var(--text-secondary)]">
        Noch keine Töpfe vorhanden. Lege zuerst Ziel-Töpfe unter{" "}
        <Link href="/allokation" className="font-medium text-[var(--accent)] underline">
          Allokation
        </Link>{" "}
        an.
      </p>
    ) : (
      <>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="text-[var(--text-secondary)]">Überschuss heute:</span>
          <span className="font-semibold tabular-nums">
            {formatWholeEuroDE(baseSurplusCents)} / Monat
          </span>
          <span className="text-[var(--text-secondary)]">· aus Allokation</span>
          {isDummy ? <StatusBadge variant="modeled" detail="Dummy-Daten" /> : null}
          {!hasHouseholdData ? (
            <StatusBadge
              variant="calibration_warning"
              label="Keine Haushaltsdaten"
            />
          ) : null}
        </div>

        <SliderField
          id="planung-delta"
          label="Änderung pro Monat"
          kind="euro"
          value={state.deltaCents}
          min={-100_000}
          max={200_000}
          step={5_000}
          onChange={(v) => dispatch({ type: "setDelta", value: v })}
        />

        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="planung-from"
            className="text-xs font-medium text-[var(--text-secondary)]"
          >
            Gilt ab Monat
          </label>
          <MonthPicker
            id="planung-from"
            value={state.fromMonth}
            min={startMonth}
            onChange={(next) =>
              dispatch({
                type: "setFromMonth",
                value: next,
                startMonth,
              })
            }
            className="w-44"
          />
        </div>
      </>
    );

  const advanced =
    pots.length === 0 ? undefined : (
      <SliderField
        id="planung-salary-horizon"
        label="Betrachtungszeitraum"
        kind="years"
        value={state.horizonYears}
        min={1}
        max={MAX_SALARY_HORIZON_YEARS}
        step={1}
        onChange={(v) => dispatch({ type: "setHorizonYears", value: v })}
        hint={`Standard: ${DEFAULT_SALARY_HORIZON_YEARS} Jahre`}
      />
    );

  const resultContent = (() => {
    if (view.kind === "no_pots") {
      return (
        <div className="rounded-lg border border-dashed border-[var(--border)] px-4 py-8 text-center text-sm text-[var(--text-secondary)]">
          Keine Töpfe vorhanden.{" "}
          <Link href="/allokation" className="font-medium text-[var(--accent)] underline">
            Unter Allokation anlegen
          </Link>
        </div>
      );
    }

    if (view.kind === "invalid") {
      return (
        <p
          role="alert"
          className="rounded-lg border border-[var(--rose)]/40 bg-[var(--rose)]/10 px-3 py-2 text-xs text-[var(--rose)]"
        >
          Eingabe ungültig: {view.message}
        </p>
      );
    }

    const { result } = view;
    const xTicks = pickYearTicks(startMonth, chartHorizon, 6);
    const markerIdx = effectiveFromIndex(
      startMonth,
      view.input.change.effectiveFromMonth,
    );
    const markers =
      markerIdx > 0 && markerIdx <= chartHorizon
        ? [{ x: markerIdx, label: "Gilt ab", role: "scenario" as const }]
        : [];

    const targetPots = result.pots.filter((p) => p.hasTarget);
    const tableRows = targetPots.map((p) => ({
      pot: p.potName,
      baseline: p.alreadyFilled ? (
        <span className="text-[var(--emerald)]">bereits gefüllt</span>
      ) : p.baselineFillMonth ? (
        formatYearMonthDE(p.baselineFillMonth)
      ) : (
        "nicht im Zeitraum"
      ),
      scenario: p.alreadyFilled ? (
        <span className="text-[var(--emerald)]">bereits gefüllt</span>
      ) : p.scenarioFillMonth ? (
        formatYearMonthDE(p.scenarioFillMonth)
      ) : (
        "nicht im Zeitraum"
      ),
      effect: p.alreadyFilled ? "–" : gainLabel(p.monthsGained),
    }));

    return (
      <div className="flex flex-col gap-4">
        <div aria-live="polite" className="flex flex-col gap-1">
          <p className="text-base font-semibold tracking-tight tabular-nums">
            {headlines.primary}
          </p>
          {headlines.secondary ? (
            headlines.tone === "warning" ? (
              <p className="rounded-lg border border-[var(--rose)]/40 bg-[var(--rose)]/10 px-3 py-2 text-xs text-[var(--rose)]">
                {headlines.secondary}
              </p>
            ) : (
              <p className="text-sm tabular-nums text-[var(--text-secondary)]">
                {headlines.secondary}
              </p>
            )
          ) : null}
        </div>

        {view.baseSurplusNonPositive ? (
          <p className="text-xs text-[var(--text-secondary)]">
            Heute bleibt nichts übrig – ohne Änderung füllen sich die Töpfe
            nicht.
          </p>
        ) : null}

        {view.targetPotCount === 0 ? (
          <p className="text-xs text-[var(--text-secondary)]">
            <Link href="/allokation" className="font-medium text-[var(--accent)] underline">
              Unter Allokation Ziele festlegen
            </Link>
          </p>
        ) : (
          <>
            <TimelineRangeChart
              rows={toFillTimelineRows(result)}
              xMax={chartHorizon}
              xTicks={xTicks}
              xTooltipLabel={(x) => xLabelForMonthIndex(startMonth, x)}
              fromLabel="heute"
              toLabel="mit Änderung"
              markers={markers}
              ariaLabel={headlines.primary}
            />

            {view.hiddenPotCount > 0 ? (
              <p className="text-xs text-[var(--text-secondary)]">
                {view.hiddenPotCount}{" "}
                {view.hiddenPotCount === 1 ? "Topf" : "Töpfe"} ohne Ziel nicht
                dargestellt.
              </p>
            ) : null}
          </>
        )}

        <details
          onToggle={(e) => setSavingsOpen(e.currentTarget.open)}
          className="rounded-lg border border-[var(--border)] px-3 py-2"
        >
          <summary className="cursor-pointer text-xs font-medium text-[var(--text-secondary)]">
            Verlauf der Rücklagen
          </summary>
          <div className="mt-3 flex flex-col gap-3">
            <p className="text-xs text-[var(--text-secondary)]">
              Summe in allen Töpfen angespart (heute vs. mit Änderung).
            </p>
            {savingsSeries ? (
              <>
                <LineChart
                  series={toSavingsSeries(savingsSeries, chartHorizon)}
                  xDomain={[0, Math.max(1, chartHorizon)]}
                  xTicks={xTicks}
                  xTooltipLabel={(x) => xLabelForMonthIndex(startMonth, x)}
                  markers={markers}
                  height={220}
                  ariaLabel="Verlauf der Rücklagen in allen Töpfen"
                />
                <ChartLegend
                  items={[
                    {
                      role: "baseline",
                      dashed: true,
                      shape: "line",
                      label: "heute",
                    },
                    {
                      role: "scenario",
                      dashed: true,
                      shape: "line",
                      label: "mit Änderung",
                    },
                  ]}
                />
              </>
            ) : null}
          </div>
        </details>

        {view.targetPotCount > 0 ? (
          <ChartDataTable
            summary="Werte anzeigen"
            columns={[
              { key: "pot", header: "Topf" },
              { key: "baseline", header: "heute" },
              { key: "scenario", header: "mit Änderung" },
              { key: "effect", header: "Effekt" },
            ]}
            rows={tableRows}
          />
        ) : null}
      </div>
    );
  })();

  return (
    <PlanningPanelLayout
      title="Mehr Gehalt"
      intro="Wann sind meine Töpfe voll, wenn sich der Monatsüberschuss ab einem Monat ändert?"
      controls={controls}
      advanced={advanced}
      advancedModified={isSalaryAdvancedModified(state)}
      onReset={() => dispatch({ type: "reset", startMonth })}
      isStale={isStale}
      result={resultContent}
    />
  );
}
