"use client";

import * as React from "react";
import Link from "next/link";
import { ChevronDown, ChevronRight } from "lucide-react";
import { ChartDataTable } from "@/components/charts/chart-data-table";
import { ChartLegend } from "@/components/charts/chart-legend";
import {
  formatWholeEuroDE,
  pickDateTicks,
  pickYearTicks,
} from "@/components/charts/chart-scale";
import { LineChart, type LineSeries } from "@/components/charts/line-chart";
import { StatusBadge } from "@/components/status-badge";
import { PaymentSplitSection } from "@/components/vertraege/payment-split-section";
import { formatMonthYearDE } from "@/components/vertraege/labels";
import type { DomainContract } from "@/lib/domain/contracts";
import {
  buildRateChangeTimingSeries,
  compareLoanAdjustments,
} from "@/lib/domain/contract-series";
import {
  addMonthsToIsoDate,
  addMonthsToYearMonth,
  dayNumberToIsoDate,
  isoDateToDayNumber,
  parseYearMonth,
} from "@/lib/domain/date";
import { buildLoanComparison } from "@/lib/domain/loan-comparison";
import { formatBpsDE, formatCentsDE } from "@/lib/domain/money";
import { DEFAULT_RECOMMENDATION_ASSUMPTIONS } from "@/lib/domain/recommendation";
import {
  ALLOWED_CHURCH_TAX_BPS,
  MAX_SAVER_ALLOWANCE_CENTS,
} from "@/lib/domain/scenarios";
import { cn } from "@/lib/utils";
import { SliderField } from "./euro-slider-field";
import { formatIsoDateDE, formatYearMonthDE } from "./format";
import { LoanComparisonTable } from "./loan-comparison-table";
import { toPrepaymentSeries } from "./planning-chart-data";
import { buildFreeMoneyHeadlines } from "./planning-headlines";
import { PlanningPanelLayout } from "./planning-panel-layout";
import {
  canUseRateIncreaseChannel,
  deriveFreeMoneyView,
  isFreeMoneyAdvancedModified,
  safeBreakEven,
  type FreeMoneyAction,
  type FreeMoneyState,
  type LoanOption,
} from "./planning-state";
import { DatePicker } from "@/components/ui/date-picker";
import { Select } from "@/components/ui/select";

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

function loanOptionToContract(
  option: LoanOption,
  asOfDate: string,
): DomainContract {
  if (option.contract) return option.contract;
  const { loan, horizonEstimated, horizonEndDate, specialAllowance } =
    option.defaults;
  return {
    id: option.id,
    name: option.name,
    category: "loan",
    status: "active",
    currentBalanceCents: loan.balanceCents,
    balanceAsOfDate: asOfDate,
    monthlyRateCents: loan.monthlyRateCents,
    interestRateBps: loan.interestRateBps,
    repaymentType: loan.repaymentType,
    fixedInterestUntil: horizonEstimated ? null : horizonEndDate,
    specialRepaymentRight: specialAllowance.status,
    specialRepaymentBasis:
      specialAllowance.status === "allowed" && specialAllowance.capCents != null
        ? "fixed_yearly"
        : null,
    specialRepaymentMaxYearlyCents:
      specialAllowance.status === "allowed" ? specialAllowance.capCents : null,
  };
}

function monthDiff(fromYm: string, toYm: string): number {
  const from = parseYearMonth(fromYm, "fromYm");
  const to = parseYearMonth(toYm, "toYm");
  return (to.year - from.year) * 12 + (to.month - from.month);
}

export function FreeMoneyPanel({
  state,
  dispatch,
  asOfDate,
  loanOptions,
}: FreeMoneyPanelProps) {
  const deferred = React.useDeferredValue(state);
  const isStale = state !== deferred;
  const [timingOpen, setTimingOpen] = React.useState(false);

  // Ranking depends only on contracts + assumptions (never on detail sliders).
  const domainContracts = React.useMemo(
    () => loanOptions.map((o) => loanOptionToContract(o, asOfDate)),
    [loanOptions, asOfDate],
  );

  const comparisonRows = React.useMemo(
    () =>
      buildLoanComparison(domainContracts, {
        asOfDate,
        assumptions: {
          etfAnnualReturnBps: deferred.returnBps,
          safetyMarginBps: DEFAULT_RECOMMENDATION_ASSUMPTIONS.safetyMarginBps,
          saverAllowanceCents: deferred.allowanceCents,
          churchTaxBps: deferred.churchTaxBps,
        },
      }),
    [
      domainContracts,
      asOfDate,
      deferred.returnBps,
      deferred.allowanceCents,
      deferred.churchTaxBps,
    ],
  );

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
    deferred.monthlyChannel,
    deferred.rateStartMonth,
    deferred.allowanceCents,
    deferred.churchTaxBps,
    deferred.usedThisYearCents,
    deferred.horizonOverride,
    loanOptions,
    asOfDate,
  ]);

  const headlines = buildFreeMoneyHeadlines(view, breakEven);
  const activeLoan =
    loanOptions.find((o) => o.id === state.loanId) ?? loanOptions[0] ?? null;
  const activeContract = React.useMemo(
    () => (activeLoan ? loanOptionToContract(activeLoan, asOfDate) : null),
    [activeLoan, asOfDate],
  );

  const horizonEndDate =
    state.horizonOverride &&
    activeLoan &&
    state.horizonOverride.loanId === activeLoan.id
      ? state.horizonOverride.date
      : (activeLoan?.defaults.horizonEndDate ?? asOfDate);

  const specialAllowance = activeLoan?.defaults.specialAllowance ?? null;
  const rateCorridor = activeLoan?.defaults.rateCorridor ?? null;
  const rateChannelAllowed = canUseRateIncreaseChannel(activeLoan);

  const oneTimeDisabled =
    specialAllowance !== null &&
    (specialAllowance.status === "none" ||
      (specialAllowance.remainingCents !== null &&
        specialAllowance.remainingCents === 0));

  const oneTimeMaxCents = React.useMemo(() => {
    if (oneTimeDisabled) return 0;
    if (
      specialAllowance?.remainingCents !== null &&
      specialAllowance?.remainingCents !== undefined
    ) {
      return specialAllowance.remainingCents;
    }
    return 5_000_000;
  }, [oneTimeDisabled, specialAllowance]);

  const oneTimeHint = React.useMemo(() => {
    if (!specialAllowance) return undefined;
    if (specialAllowance.status === "none") {
      return "Sondertilgung laut Vertrag nicht möglich.";
    }
    if (specialAllowance.remainingCents === 0) {
      return "Jahreskontingent für dieses Jahr bereits ausgeschöpft.";
    }
    if (
      specialAllowance.status === "unknown" ||
      specialAllowance.flags.capUnknown
    ) {
      return "Sondertilgungsrecht im Vertrag prüfen.";
    }
    if (specialAllowance.remainingCents !== null) {
      return `Restkontingent: ${formatWholeEuroDE(specialAllowance.remainingCents)}`;
    }
    return undefined;
  }, [specialAllowance]);

  const rateDisabledReason = React.useMemo(() => {
    if (!rateCorridor || rateChannelAllowed) return null;
    if (rateCorridor.status === "not_applicable") {
      return "Bei endfälligen Darlehen nicht anwendbar.";
    }
    if (rateCorridor.status === "none") {
      return "Tilgungssatzwechsel laut Vertrag nicht möglich.";
    }
    if (rateCorridor.flags.exhausted) {
      return "Alle vereinbarten Wechsel bereits genutzt.";
    }
    if (rateCorridor.flags.corridorEmpty) {
      return "Tilgungssatz- und Raten-Korridor überschneiden sich aktuell nicht.";
    }
    return "Aktuelle Rate liegt bereits am oberen Korridor-Ende.";
  }, [rateCorridor, rateChannelAllowed]);

  const rateIncreaseMaxCents = React.useMemo(() => {
    if (!rateCorridor || rateCorridor.maxMonthlyCents === null) return 0;
    return Math.max(
      0,
      rateCorridor.maxMonthlyCents - rateCorridor.currentMonthlyCents,
    );
  }, [rateCorridor]);

  const startYm = (activeLoan?.defaults.startDate ?? asOfDate).slice(0, 7);
  const minRateStartYm = addMonthsToYearMonth(startYm, 1);
  const maxRateStartYm = rateCorridor?.latestChangeDate
    ? rateCorridor.latestChangeDate.slice(0, 7)
    : undefined;
  const selectedRateStartYm = addMonthsToYearMonth(
    startYm,
    Math.max(1, state.rateStartMonth),
  );

  // Payment split & timing series for the selected loan
  const splitComparison = React.useMemo(() => {
    if (!activeContract) return null;
    const isRate =
      deferred.monthlyChannel === "rate_increase" &&
      deferred.monthlyCents > 0 &&
      rateChannelAllowed;
    const specialOpt =
      deferred.oneTimeCents > 0
        ? {
            amountCents: deferred.oneTimeCents,
            date: asOfDate,
            repeatYearly: false,
            usedThisYearCents: deferred.usedThisYearCents,
          }
        : null;
    const rateOpt = isRate
      ? {
          date: addMonthsToIsoDate(asOfDate, Math.max(1, deferred.rateStartMonth)),
          newMonthlyRateCents:
            activeContract.monthlyRateCents + deferred.monthlyCents,
        }
      : null;
    try {
      return compareLoanAdjustments(activeContract, {
        asOfDate,
        specialRepayment: specialOpt,
        rateChange: rateOpt,
      });
    } catch {
      return null;
    }
  }, [
    activeContract,
    asOfDate,
    deferred.oneTimeCents,
    deferred.monthlyCents,
    deferred.monthlyChannel,
    deferred.rateStartMonth,
    deferred.usedThisYearCents,
    rateChannelAllowed,
  ]);

  const timingSeries = React.useMemo(() => {
    if (
      !activeContract ||
      deferred.monthlyChannel !== "rate_increase" ||
      deferred.monthlyCents <= 0 ||
      !rateChannelAllowed ||
      horizonEndDate <= asOfDate
    ) {
      return null;
    }
    try {
      return buildRateChangeTimingSeries(activeContract, {
        asOfDate,
        newMonthlyRateCents:
          activeContract.monthlyRateCents + deferred.monthlyCents,
        horizonEndDate,
        maxPoints: 36,
      });
    } catch {
      return null;
    }
  }, [
    activeContract,
    asOfDate,
    deferred.monthlyChannel,
    deferred.monthlyCents,
    horizonEndDate,
    rateChannelAllowed,
  ]);

  const timingChart = React.useMemo(() => {
    if (!timingSeries || timingSeries.points.length < 2) return null;
    const pts = timingSeries.points.map((p) => ({
      x: isoDateToDayNumber(p.startDate),
      y: p.interestSavedCents,
    }));
    const firstX = pts[0]!.x;
    const lastX = pts[pts.length - 1]!.x;
    const series: LineSeries[] = [
      {
        id: "timing",
        label: "Zinsersparnis nach Startmonat",
        role: "optionA",
        dashed: true,
        points: pts,
      },
    ];
    return {
      series,
      xDomain: [firstX, lastX] as [number, number],
      xTicks: pickDateTicks(firstX, lastX, 5, { variant: "projection" }),
    };
  }, [timingSeries]);

  const isRateChannelActive =
    state.monthlyChannel === "rate_increase" && rateChannelAllowed;

  const controls =
    loanOptions.length === 0 ? (
      <p className="text-sm text-[var(--text-secondary)]">
        Kein aktiver Kredit vorhanden. Lege zuerst einen Kredit unter{" "}
        <Link
          href="/vertraege"
          className="font-medium text-[var(--accent)] underline"
        >
          Verträge
        </Link>{" "}
        an.
      </p>
    ) : (
      <>
        {activeLoan ? (
          <div className="flex flex-col gap-0.5">
            <p className="text-sm font-medium text-[var(--text-primary)]">
              {activeLoan.name}
              {activeLoan.provider ? ` · ${activeLoan.provider}` : ""}
            </p>
            <p className="text-xs tabular-nums text-[var(--text-secondary)]">
              Restschuld (projiziert):{" "}
              {formatCentsDE(activeLoan.defaults.loan.balanceCents)} ·{" "}
              {formatBpsDE(activeLoan.defaults.loan.interestRateBps)} · Rate{" "}
              {formatCentsDE(activeLoan.defaults.loan.monthlyRateCents)}
            </p>
          </div>
        ) : null}

        <SliderField
          id="planung-onetime"
          label="Einmalbetrag"
          kind="euro"
          value={oneTimeDisabled ? 0 : state.oneTimeCents}
          min={0}
          max={oneTimeMaxCents}
          step={50_000}
          disabled={oneTimeDisabled}
          hint={oneTimeHint}
          onChange={(v) =>
            dispatch({ type: "setField", field: "oneTimeCents", value: v })
          }
        />

        {/* Monthly channel toggle */}
        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-[var(--text-secondary)]">
            Monatlichen Betrag verwenden
          </span>
          <div
            role="group"
            aria-label="Kanal für monatlichen Betrag"
            className="grid grid-cols-2 gap-1 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-1"
          >
            <button
              type="button"
              aria-pressed={state.monthlyChannel === "special_repayment"}
              onClick={() =>
                dispatch({
                  type: "setMonthlyChannel",
                  channel: "special_repayment",
                })
              }
              className={cn(
                "rounded-md px-2 py-1.5 text-xs font-medium transition-colors outline-hidden focus-visible:ring-[3px] focus-visible:ring-[color-mix(in_srgb,var(--accent)_30%,transparent)]",
                state.monthlyChannel === "special_repayment"
                  ? "bg-[var(--accent)] text-white"
                  : "text-[var(--text-secondary)] hover:bg-[var(--surface-elevated)] hover:text-[var(--text-primary)]",
              )}
            >
              als Sondertilgung ansparen
            </button>
            <button
              type="button"
              aria-pressed={state.monthlyChannel === "rate_increase"}
              disabled={!rateChannelAllowed}
              onClick={() =>
                dispatch({
                  type: "setMonthlyChannel",
                  channel: "rate_increase",
                })
              }
              className={cn(
                "rounded-md px-2 py-1.5 text-xs font-medium transition-colors outline-hidden focus-visible:ring-[3px] focus-visible:ring-[color-mix(in_srgb,var(--accent)_30%,transparent)] disabled:cursor-not-allowed disabled:opacity-45",
                state.monthlyChannel === "rate_increase" && rateChannelAllowed
                  ? "bg-[var(--accent)] text-white"
                  : "text-[var(--text-secondary)] hover:bg-[var(--surface-elevated)] hover:text-[var(--text-primary)]",
              )}
            >
              als höhere Rate
            </button>
          </div>
          {rateDisabledReason ? (
            <p className="text-[11px] text-[var(--text-secondary)]">
              Höhere Rate nicht verfügbar: {rateDisabledReason}
            </p>
          ) : null}
        </div>

        <SliderField
          id="planung-monthly"
          label={
            isRateChannelActive
              ? "Monatliche Ratenerhöhung"
              : "Monatliche Sparrate"
          }
          kind="euro"
          value={state.monthlyCents}
          min={0}
          max={isRateChannelActive ? rateIncreaseMaxCents : 200_000}
          step={isRateChannelActive ? 1_000 : 2_500}
          hint={
            isRateChannelActive && activeLoan
              ? `Neue Rate: ${formatCentsDE(activeLoan.defaults.loan.monthlyRateCents + state.monthlyCents)} / Monat (max. +${formatWholeEuroDE(rateIncreaseMaxCents)})${
                  rateCorridor?.flags.corridorAssumed
                    ? " · Korridor angenommen (1–10 %)"
                    : ""
                }`
              : undefined
          }
          onChange={(v) =>
            dispatch({ type: "setField", field: "monthlyCents", value: v })
          }
        />

        {isRateChannelActive ? (
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="planung-rate-start"
              className="text-xs font-medium text-[var(--text-secondary)]"
            >
              Startmonat der höheren Rate
            </label>
            <input
              id="planung-rate-start"
              type="month"
              min={minRateStartYm}
              max={maxRateStartYm}
              value={selectedRateStartYm}
              onChange={(e) => {
                if (!e.target.value) return;
                try {
                  const diff = monthDiff(startYm, e.target.value);
                  dispatch({
                    type: "setRateStartMonth",
                    month: Math.max(1, diff),
                  });
                } catch {
                  // ignore incomplete input
                }
              }}
              className="h-9 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 text-sm tabular-nums"
            />
          </div>
        ) : null}
      </>
    );

  const advanced =
    loanOptions.length === 0 ? undefined : (
      <>
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
          <Select
            id="planung-kist"
            value={state.churchTaxBps}
            onChange={(e) =>
              dispatch({ type: "setChurchTax", bps: Number(e.target.value) })
            }
          >
            {ALLOWED_CHURCH_TAX_BPS.map((bps) => (
              <option key={bps} value={bps}>
                {bps === 0 ? "keine" : `${bps / 100} %`}
              </option>
            ))}
          </Select>
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
            dispatch({
              type: "setField",
              field: "usedThisYearCents",
              value: v,
            })
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
          <DatePicker
            id="planung-horizon"
            value={horizonEndDate}
            clearable={false}
            onChange={(next) => {
              if (next) {
                dispatch({ type: "setHorizon", date: next });
              }
            }}
            className="w-40"
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
          {splitComparison && activeLoan ? (
            <PaymentSplitSection
              contractName={activeLoan.name}
              baseline={splitComparison.baseline}
              adjusted={null}
            />
          ) : null}
        </div>
      );
    }

    const { result, input, loan } = view;
    const isRate =
      input.monthlyChannel === "rate_increase" && input.monthlyAmountCents > 0;
    const optionALabel = isRate ? "Höhere Rate" : "Sondertilgung";
    const series = toPrepaymentSeries(result.timeline).map((s) =>
      s.id === "prepayment" ? { ...s, label: optionALabel } : s,
    );
    const inputStartYm = input.startDate.slice(0, 7);
    const xTicks = pickYearTicks(
      addMonthsToYearMonth(inputStartYm, 1),
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
              : formatYearMonthDE(addMonthsToYearMonth(inputStartYm, x))
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
              label: optionALabel,
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
              Zinsersparnis ({optionALabel})
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
        result.flags.capNone ||
        result.flags.rateBelowInterest ||
        result.capLimitedOverflowCents > 0 ||
        result.rateLimitedOverflowCents > 0 ? (
          <ul className="flex flex-col gap-2">
            {result.flags.capNone && !isRate ? (
              <Warning>
                Sondertilgung ist laut Vertrag nicht möglich – das Budget fließt
                vollständig ins ETF.
              </Warning>
            ) : null}
            {result.flags.capUnknown && !isRate ? (
              <Warning>
                Kein Sondertilgungsrecht hinterlegt – unbegrenzt angenommen.
              </Warning>
            ) : null}
            {result.flags.rateBelowInterest ? (
              <Warning>
                Die Rate liegt unter den Monatszinsen – die Restschuld wächst
                ohne Sondertilgung.
              </Warning>
            ) : null}
            {result.capLimitedOverflowCents > 0 ? (
              <Warning>
                Sondertilgung durch den Jahresdeckel gekürzt:{" "}
                {formatWholeEuroDE(result.capLimitedOverflowCents)} fließen
                stattdessen ins ETF.
              </Warning>
            ) : null}
            {result.rateLimitedOverflowCents > 0 ? (
              <Warning>
                Ratenerhöhung durch den Vertragskorridor begrenzt:{" "}
                {formatWholeEuroDE(result.rateLimitedOverflowCents)} fließen
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
            { key: "prepayment", header: optionALabel, align: "right" },
            { key: "etf", header: "ETF", align: "right" },
          ]}
          rows={yearlyRows}
        />

        {/* Shared Payment Split Section */}
        {splitComparison && activeLoan ? (
          <PaymentSplitSection
            contractName={activeLoan.name}
            baseline={splitComparison.baseline}
            adjusted={splitComparison.adjusted}
          />
        ) : null}

        {/* Timing Mini-Chart behind Erweitert */}
        {timingChart && timingSeries ? (
          <div className="border-t border-[var(--border)] pt-3">
            <button
              type="button"
              onClick={() => setTimingOpen((v) => !v)}
              aria-expanded={timingOpen}
              className="flex w-full items-center justify-between text-left text-xs font-medium text-[var(--text-primary)] hover:text-[var(--accent)]"
            >
              <span>Erweitert: Wirkung nach Startmonat der Ratenerhöhung</span>
              {timingOpen ? (
                <ChevronDown className="h-4 w-4" />
              ) : (
                <ChevronRight className="h-4 w-4" />
              )}
            </button>
            {timingOpen ? (
              <div className="mt-3 space-y-2">
                {timingSeries.costPerYearDelayCents != null &&
                timingSeries.costPerYearDelayCents > 0 ? (
                  <p className="text-xs text-[var(--text-secondary)]">
                    Jedes Jahr später kostet ca.{" "}
                    <span className="tabular-nums font-medium text-[var(--text-primary)]">
                      {formatWholeEuroDE(timingSeries.costPerYearDelayCents)}
                    </span>{" "}
                    Zinsersparnis.
                  </p>
                ) : null}
                <LineChart
                  series={timingChart.series}
                  xDomain={timingChart.xDomain}
                  xTicks={timingChart.xTicks}
                  xTooltipLabel={(x) =>
                    formatMonthYearDE(dayNumberToIsoDate(Math.round(x)))
                  }
                  height={160}
                  ariaLabel={`Zinsersparnis nach Startmonat für ${loan.name}`}
                />
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    );
  })();

  return (
    <div className="flex flex-col gap-5">
      {comparisonRows.length > 0 ? (
        <LoanComparisonTable
          rows={comparisonRows}
          selectedLoanId={state.loanId}
          onSelectLoan={(loanId) => dispatch({ type: "setLoan", loanId })}
        />
      ) : null}

      <PlanningPanelLayout
        title="Darlehen & ETF"
        intro="Gleiches Budget, zwei Wege: Kredit per Sondertilgung oder höherer Rate abbauen vs. regulär weiterlaufen lassen und ins ETF sparen."
        controls={controls}
        advanced={advanced}
        advancedModified={isFreeMoneyAdvancedModified(state, activeLoan)}
        onReset={() => dispatch({ type: "reset", loans: loanOptions, asOfDate })}
        isStale={isStale}
        result={resultContent}
      />
    </div>
  );
}
