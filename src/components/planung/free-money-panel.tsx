"use client";

import * as React from "react";
import Link from "next/link";
import { ChartDataTable } from "@/components/charts/chart-data-table";
import { ChartLegend } from "@/components/charts/chart-legend";
import { formatWholeEuroDE, pickYearTicks } from "@/components/charts/chart-scale";
import { LineChart } from "@/components/charts/line-chart";
import { StatusBadge } from "@/components/status-badge";
import { addMonthsToYearMonth } from "@/lib/domain/date";
import { formatBpsDE, formatCentsDE } from "@/lib/domain/money";
import {
  ALLOWED_CHURCH_TAX_BPS,
  MAX_SAVER_ALLOWANCE_CENTS,
} from "@/lib/domain/scenarios";
import { SliderField } from "./euro-slider-field";
import { formatIsoDateDE, formatYearMonthDE } from "./format";
import { toPrepaymentSeries } from "./planning-chart-data";
import { buildFreeMoneyHeadlines } from "./planning-headlines";
import { PlanningPanelLayout } from "./planning-panel-layout";
import {
  deriveFreeMoneyView,
  isFreeMoneyAdvancedModified,
  safeBreakEven,
  type FreeMoneyAction,
  type FreeMoneyState,
  type LoanOption,
} from "./planning-state";

interface FreeMoneyPanelProps {
  state: FreeMoneyState;
  dispatch: React.Dispatch<FreeMoneyAction>;
  asOfDate: string;
  loanOptions: LoanOption[];
}

function Warning({ children }: { children: React.ReactNode }) {
  return (
    <li className="rounded-lg border border-[var(--amber)]/40 bg-[var(--amber)]/10 px-3 py-2 text-xs text-[var(--text-primary)]">
      {children}
    </li>
  );
}

export function FreeMoneyPanel({
  state,
  dispatch,
  asOfDate,
  loanOptions,
}: FreeMoneyPanelProps) {
  const deferred = React.useDeferredValue(state);
  const isStale = state !== deferred;

  const view = React.useMemo(
    () => deriveFreeMoneyView(deferred, loanOptions, asOfDate),
    [deferred, loanOptions, asOfDate],
  );

  // Break-even does not depend on returnBps; avoid recomputing while dragging the return slider.
  const breakEven = React.useMemo(() => {
    const viewForBreakEven = deriveFreeMoneyView(
      { ...deferred, returnBps: 0 },
      loanOptions,
      asOfDate,
    );
    return safeBreakEven(viewForBreakEven);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    deferred.loanId,
    deferred.oneTimeCents,
    deferred.monthlyCents,
    deferred.allowanceCents,
    deferred.churchTaxBps,
    deferred.usedThisYearCents,
    deferred.horizonOverride,
    loanOptions,
    asOfDate,
  ]);

  const headlines = buildFreeMoneyHeadlines(view, breakEven);
  const activeLoan = loanOptions.find((o) => o.id === state.loanId) ?? loanOptions[0] ?? null;
  const horizonEndDate =
    state.horizonOverride && activeLoan && state.horizonOverride.loanId === activeLoan.id
      ? state.horizonOverride.date
      : (activeLoan?.defaults.horizonEndDate ?? asOfDate);

  const controls =
    loanOptions.length === 0 ? (
      <p className="text-sm text-[var(--text-secondary)]">
        Kein aktiver Kredit vorhanden. Lege zuerst einen Kredit unter{" "}
        <Link href="/vertraege" className="font-medium text-[var(--accent)] underline">
          Verträge
        </Link>{" "}
        an.
      </p>
    ) : (
      <>
        <div className="flex flex-col gap-1.5">
          {loanOptions.length >= 2 ? (
            <>
              <label
                htmlFor="planung-loan"
                className="text-xs font-medium text-[var(--text-secondary)]"
              >
                Kredit
              </label>
              <select
                id="planung-loan"
                value={state.loanId}
                onChange={(e) =>
                  dispatch({ type: "setLoan", loanId: e.target.value })
                }
                className="h-9 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 text-sm"
              >
                {loanOptions.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                    {o.provider ? ` · ${o.provider}` : ""}
                  </option>
                ))}
              </select>
            </>
          ) : activeLoan ? (
            <p className="text-sm font-medium text-[var(--text-primary)]">
              {activeLoan.name}
              {activeLoan.provider ? ` · ${activeLoan.provider}` : ""}
            </p>
          ) : null}
          {activeLoan ? (
            <p className="text-xs tabular-nums text-[var(--text-secondary)]">
              Restschuld (projiziert):{" "}
              {formatCentsDE(activeLoan.defaults.loan.balanceCents)} ·{" "}
              {formatBpsDE(activeLoan.defaults.loan.interestRateBps)} · Rate{" "}
              {formatCentsDE(activeLoan.defaults.loan.monthlyRateCents)}
            </p>
          ) : null}
        </div>

        <SliderField
          id="planung-onetime"
          label="Einmalbetrag"
          kind="euro"
          value={state.oneTimeCents}
          min={0}
          max={5_000_000}
          step={50_000}
          onChange={(v) =>
            dispatch({ type: "setField", field: "oneTimeCents", value: v })
          }
        />
        <SliderField
          id="planung-monthly"
          label="Monatliche Sparrate"
          kind="euro"
          value={state.monthlyCents}
          min={0}
          max={200_000}
          step={2_500}
          onChange={(v) =>
            dispatch({ type: "setField", field: "monthlyCents", value: v })
          }
        />
        <SliderField
          id="planung-return"
          label="ETF-Rendite p. a."
          kind="percent"
          value={state.returnBps}
          min={0}
          max={1000}
          step={25}
          onChange={(v) =>
            dispatch({ type: "setField", field: "returnBps", value: v })
          }
        />
      </>
    );

  const advanced =
    loanOptions.length === 0 ? undefined : (
      <>
        <SliderField
          id="planung-allowance"
          label="Sparerpauschbetrag verfügbar"
          kind="euro"
          value={state.allowanceCents}
          min={0}
          max={MAX_SAVER_ALLOWANCE_CENTS}
          step={10_000}
          onChange={(v) =>
            dispatch({ type: "setField", field: "allowanceCents", value: v })
          }
        />
        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="planung-kist"
            className="text-xs font-medium text-[var(--text-secondary)]"
          >
            Kirchensteuer
          </label>
          <select
            id="planung-kist"
            value={state.churchTaxBps}
            onChange={(e) =>
              dispatch({ type: "setChurchTax", bps: Number(e.target.value) })
            }
            className="h-9 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 text-sm"
          >
            {ALLOWED_CHURCH_TAX_BPS.map((bps) => (
              <option key={bps} value={bps}>
                {bps === 0 ? "keine" : `${bps / 100} %`}
              </option>
            ))}
          </select>
        </div>
        <SliderField
          id="planung-used"
          label="Bereits genutzte Sondertilgung in diesem Jahr"
          kind="euro"
          value={state.usedThisYearCents}
          min={0}
          max={5_000_000}
          step={50_000}
          onChange={(v) =>
            dispatch({ type: "setField", field: "usedThisYearCents", value: v })
          }
        />
        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="planung-horizon"
            className="flex items-center gap-2 text-xs font-medium text-[var(--text-secondary)]"
          >
            Horizont
            {activeLoan?.defaults.horizonEstimated &&
            state.horizonOverride?.loanId !== state.loanId ? (
              <StatusBadge variant="modeled" label="geschätzt" />
            ) : null}
          </label>
          <input
            id="planung-horizon"
            type="date"
            value={horizonEndDate}
            onChange={(e) => {
              if (e.target.value) {
                dispatch({ type: "setHorizon", date: e.target.value });
              }
            }}
            className="h-9 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 text-sm tabular-nums"
          />
        </div>
      </>
    );

  const resultContent = (() => {
    if (view.kind === "no_loans") {
      return (
        <div className="rounded-lg border border-dashed border-[var(--border)] px-4 py-8 text-center text-sm text-[var(--text-secondary)]">
          Ohne Kredit gibt es nichts zu vergleichen.
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

    const headlineBlock = (
      <div aria-live="polite" className="flex flex-col gap-1">
        <p className="text-base font-semibold tracking-tight tabular-nums">
          {headlines.primary}
        </p>
        {headlines.secondary ? (
          <p className="text-sm tabular-nums text-[var(--text-secondary)]">
            {headlines.secondary}
          </p>
        ) : null}
      </div>
    );

    if (view.kind === "zero_budget" || view.kind === "horizon_elapsed") {
      return (
        <div className="flex flex-col gap-4">
          {headlineBlock}
          <div className="rounded-lg border border-dashed border-[var(--border)] px-4 py-8 text-center text-xs text-[var(--text-secondary)]">
            {view.kind === "zero_budget"
              ? "Mit 0 € Einmalbetrag und 0 € Sparrate entsteht kein Unterschied."
              : "Kein Vergleichszeitraum – bitte unter „Erweitert“ einen Horizont festlegen."}
          </div>
        </div>
      );
    }

    const { result, input, loan } = view;
    const series = toPrepaymentSeries(result.timeline);
    const startYm = input.startDate.slice(0, 7);
    const xTicks = pickYearTicks(
      addMonthsToYearMonth(startYm, 1),
      result.horizonMonths,
      7,
    );
    const markerLabel =
      loan.defaults.horizonEstimated &&
      deferred.horizonOverride?.loanId !== loan.id
        ? "Horizont (geschätzt)"
        : "Ende Zinsbindung";

    const yearlyRows = result.timeline
      .filter(
        (pt, idx) =>
          pt.monthIndex % 12 === 0 || idx === result.timeline.length - 1,
      )
      .map((pt) => ({
        date: formatIsoDateDE(pt.date),
        prepayment: formatCentsDE(pt.netWorthA),
        etf: formatCentsDE(pt.netWorthB),
      }));

    return (
      <div className="flex flex-col gap-4">
        {headlineBlock}

        <LineChart
          series={series}
          xDomain={[0, Math.max(1, result.horizonMonths)]}
          xTicks={xTicks}
          xTooltipLabel={(x) =>
            x === 0
              ? "heute"
              : formatYearMonthDE(addMonthsToYearMonth(startYm, x))
          }
          markers={[
            {
              x: result.horizonMonths,
              label: markerLabel,
              role: "axisText",
            },
          ]}
          ariaLabel={`${headlines.primary} ${headlines.secondary ?? ""}`.trim()}
          tooltipExtra={(values) => {
            if (values.etf === undefined || values.prepayment === undefined) {
              return null;
            }
            return {
              label: "Unterschied",
              value: formatWholeEuroDE(values.etf - values.prepayment, {
                showPlusSign: true,
              }),
            };
          }}
        />

        <ChartLegend
          items={[
            {
              role: "optionA",
              dashed: true,
              shape: "line",
              label: "Sondertilgung",
            },
            {
              role: "optionB",
              dashed: true,
              shape: "line",
              label: "ETF-Ansparung",
            },
          ]}
        />

        <dl className="grid gap-4 border-t border-[var(--border)] pt-3 sm:grid-cols-3">
          <div>
            <dt className="text-xs text-[var(--text-secondary)]">
              Zinsersparnis (Sondertilgung)
            </dt>
            <dd className="text-base font-semibold tabular-nums text-[var(--emerald)]">
              {formatWholeEuroDE(result.interestSavedCents)}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-[var(--text-secondary)]">
              ETF netto nach Steuer
            </dt>
            <dd className="text-base font-semibold tabular-nums">
              {formatWholeEuroDE(result.etf.etfTax.netValueCents)}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-[var(--text-secondary)]">
              Break-even-Rendite
            </dt>
            <dd className="text-base font-semibold tabular-nums">
              {breakEven === null
                ? "–"
                : breakEven.kind === "identical"
                  ? "kein Unterschied"
                  : breakEven.kind === "unreachable"
                    ? "nicht erreichbar"
                    : `${formatBpsDE(breakEven.bps)} p. a.`}
            </dd>
          </div>
        </dl>

        {result.flags.capUnknown ||
        result.flags.rateBelowInterest ||
        result.capLimitedOverflowCents > 0 ? (
          <ul className="flex flex-col gap-2">
            {result.flags.capUnknown ? (
              <Warning>
                Kein Sondertilgungsrecht hinterlegt – unbegrenzt angenommen.
              </Warning>
            ) : null}
            {result.flags.rateBelowInterest ? (
              <Warning>
                Die Rate liegt unter den Monatszinsen – die Restschuld wächst ohne
                Sondertilgung.
              </Warning>
            ) : null}
            {result.capLimitedOverflowCents > 0 ? (
              <Warning>
                Sondertilgung durch den Jahresdeckel gekürzt:{" "}
                {formatWholeEuroDE(result.capLimitedOverflowCents)} fließen
                stattdessen ins ETF.
              </Warning>
            ) : null}
          </ul>
        ) : null}

        <details className="text-xs text-[var(--text-secondary)]">
          <summary className="cursor-pointer font-medium">Annahmen</summary>
          <p className="mt-1.5 leading-relaxed">
            Endbesteuerung beim fiktiven Verkauf am Horizont (Teilfreistellung
            30 %); die Vorabpauschale ist nicht modelliert und rechnet für das
            ETF konservativ.
          </p>
        </details>

        <ChartDataTable
          summary="Jahreswerte anzeigen"
          columns={[
            { key: "date", header: "Datum" },
            { key: "prepayment", header: "Sondertilgung", align: "right" },
            { key: "etf", header: "ETF", align: "right" },
          ]}
          rows={yearlyRows}
        />
      </div>
    );
  })();

  return (
    <PlanningPanelLayout
      title="Freies Geld einsetzen"
      intro="Gleiches Budget, zwei Wege: Kredit mit Sondertilgungen oder regulär weiterlaufen lassen und ins ETF sparen."
      controls={controls}
      advanced={advanced}
      advancedModified={isFreeMoneyAdvancedModified(state)}
      onReset={() => dispatch({ type: "reset", loans: loanOptions, asOfDate })}
      isStale={isStale}
      result={resultContent}
    />
  );
}
