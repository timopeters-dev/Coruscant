"use client";

import { rangeFillStyle } from "@/frontend/ui/range-fill";
import * as React from "react";
import Link from "next/link";
import { ArrowRight, RotateCcw } from "lucide-react";
import {
  formatWholeEuroDE,
  pickDateTicks,
} from "@/frontend/charts/chart-scale";
import { LineChart, type LineSeries } from "@/frontend/charts/line-chart";
import { buildPlanningHref } from "@/frontend/planung/planning-state";
import { StatusBadge } from "@/frontend/ui/status-badge";
import { Button } from "@/frontend/ui/button";
import type { DomainContract } from "@/domain/contracts/contract";
import {
  buildRateChangeTimingSeries,
  compareLoanAdjustments,
  type LoanAdjustmentEffect,
  type RateChangeOption,
  type SpecialRepaymentOption,
} from "@/domain/contracts/series";
import {
  addMonthsToYearMonth,
  dayNumberToIsoDate,
  isoDateToDayNumber,
} from "@/domain/core/date";
import {
  remainingSpecialRepaymentCents,
  repaymentBpsFromRate,
  resolveRateCorridor,
} from "@/domain/contracts/loan-options";
import { formatBpsDE, formatCentsDE } from "@/domain/core/money";
import { formatDurationMonthsDE, formatMonthYearDE } from "./labels";
import { MonthPicker } from "@/frontend/ui/date-picker";
import { Collapse, CollapseChevron } from "@/frontend/ui/collapse";
import { InfoTip } from "@/frontend/ui/info-tip";

export interface LoanAdjustmentSimulatorProps {
  contract: DomainContract;
  asOfDate: string;
  defaultOpen?: boolean;
  onEffectChange?: (effect: LoanAdjustmentEffect | null) => void;
}

function formatSignedDeltaCents(cents: number, positiveGood = true): {
  text: string;
  toneClass: string;
} {
  if (cents === 0) {
    return { text: formatCentsDE(0), toneClass: "text-[var(--text-primary)]" };
  }
  const absText = formatCentsDE(Math.abs(cents));
  if (cents > 0) {
    return {
      text: `−${absText}`,
      toneClass: positiveGood ? "text-[var(--emerald)]" : "text-[var(--rose)]",
    };
  }
  return {
    text: `+${absText}`,
    toneClass: positiveGood ? "text-[var(--rose)]" : "text-[var(--emerald)]",
  };
}

function formatSignedCashDeltaCents(cents: number): string {
  if (cents === 0) return formatCentsDE(0);
  const sign = cents > 0 ? "+" : "−";
  return `${sign}${formatCentsDE(Math.abs(cents))}`;
}

export function LoanAdjustmentSimulator({
  contract,
  asOfDate,
  defaultOpen = false,
  onEffectChange,
}: LoanAdjustmentSimulatorProps) {
  const [simOpen, setSimOpen] = React.useState(defaultOpen);
  const [timingOpen, setTimingOpen] = React.useState(false);

  const minMonth = asOfDate.slice(0, 7);
  const defaultNextMonth = React.useMemo(
    () => addMonthsToYearMonth(minMonth, 1),
    [minMonth],
  );

  const allowance = React.useMemo(
    () => remainingSpecialRepaymentCents(contract, asOfDate),
    [contract, asOfDate],
  );
  const corridor = React.useMemo(
    () => resolveRateCorridor(contract, asOfDate),
    [contract, asOfDate],
  );

  const isLumpSum =
    contract.repaymentType === "lump_sum" ||
    corridor.status === "not_applicable";

  // Special repayment slider bounds (in Euros)
  const specialDisabled =
    contract.status !== "active" ||
    allowance.status === "none" ||
    (allowance.remainingCents !== null && allowance.remainingCents === 0);

  const specialDisabledReason =
    contract.status !== "active"
      ? "Vertrag ist nicht aktiv."
      : allowance.status === "none"
        ? "Sondertilgung laut Vertrag nicht möglich."
        : allowance.remainingCents === 0
          ? "Jahreskontingent für dieses Jahr bereits ausgeschöpft."
          : null;

  const specialMaxEuros = React.useMemo(() => {
    if (specialDisabled) return 0;
    if (allowance.remainingCents !== null) {
      return Math.max(0, Math.floor(allowance.remainingCents / 100));
    }
    return Math.max(0, Math.floor(contract.currentBalanceCents / 100));
  }, [specialDisabled, allowance.remainingCents, contract.currentBalanceCents]);

  // Rate corridor slider bounds (in Euros, strictly inside corridor)
  const rateDisabled =
    contract.status !== "active" ||
    isLumpSum ||
    corridor.status === "none" ||
    corridor.flags.exhausted ||
    corridor.flags.corridorEmpty ||
    corridor.minMonthlyCents === null ||
    corridor.maxMonthlyCents === null;

  const rateDisabledReason =
    contract.status !== "active"
      ? "Vertrag ist nicht aktiv."
      : corridor.status === "none"
        ? "Tilgungssatzwechsel laut Vertrag nicht möglich."
        : corridor.flags.exhausted
          ? "Alle vereinbarten Tilgungssatzwechsel sind bereits genutzt."
          : corridor.flags.corridorEmpty
            ? "Tilgungssatz- und Raten-Korridor überschneiden sich aktuell nicht."
            : null;

  const { rateMinCents, rateMaxCents, rateMinEuros, rateMaxEuros } =
    React.useMemo(() => {
      if (
        corridor.minMonthlyCents === null ||
        corridor.maxMonthlyCents === null
      ) {
        const curEuros = Math.round(contract.monthlyRateCents / 100);
        return {
          rateMinCents: contract.monthlyRateCents,
          rateMaxCents: contract.monthlyRateCents,
          rateMinEuros: curEuros,
          rateMaxEuros: curEuros,
        };
      }
      const floorCents =
        corridor.sliderMinMonthlyCents ?? corridor.minMonthlyCents;
      const minE = Math.ceil(floorCents / 100);
      const maxE = Math.floor(corridor.maxMonthlyCents / 100);
      return {
        rateMinCents: floorCents,
        rateMaxCents: corridor.maxMonthlyCents,
        rateMinEuros: Math.min(minE, maxE),
        rateMaxEuros: Math.max(minE, maxE),
      };
    }, [corridor, contract.monthlyRateCents]);

  const currentRateEuros = Math.round(contract.monthlyRateCents / 100);

  const [specialEuros, setSpecialEuros] = React.useState(0);
  const [specialMonth, setSpecialMonth] = React.useState(defaultNextMonth);
  const [repeatYearly, setRepeatYearly] = React.useState(false);

  const [rateCents, setRateCents] = React.useState(contract.monthlyRateCents);
  const [rateStartMonth, setRateStartMonth] = React.useState(defaultNextMonth);

  const deferredSpecialEuros = React.useDeferredValue(specialEuros);
  const deferredRateCents = React.useDeferredValue(rateCents);

  const effectiveSpecialCents = specialDisabled
    ? 0
    : Math.max(0, Math.round(deferredSpecialEuros) * 100);
  const safeSpecialMonth = specialMonth >= minMonth ? specialMonth : minMonth;
  const specialDate =
    `${safeSpecialMonth}-01` >= asOfDate ? `${safeSpecialMonth}-01` : asOfDate;

  const latestChangeMonth = corridor.latestChangeDate
    ? corridor.latestChangeDate.slice(0, 7)
    : undefined;
  const safeRateStartMonth =
    rateStartMonth >= defaultNextMonth
      ? latestChangeMonth && rateStartMonth > latestChangeMonth
        ? latestChangeMonth
        : rateStartMonth
      : defaultNextMonth;
  const rateChangeDate = `${safeRateStartMonth}-01`;

  const isSpecialActive = effectiveSpecialCents > 0;
  const isRateActive =
    !rateDisabled && deferredRateCents !== contract.monthlyRateCents;
  const hasAnyAdjustment = isSpecialActive || isRateActive;

  const effect = React.useMemo<LoanAdjustmentEffect | null>(() => {
    if (!hasAnyAdjustment || contract.status !== "active") {
      return null;
    }
    const specialOption: SpecialRepaymentOption | null = isSpecialActive
      ? {
          amountCents: effectiveSpecialCents,
          date: specialDate,
          repeatYearly,
        }
      : null;

    const rateOption: RateChangeOption | null = isRateActive
      ? {
          date: rateChangeDate,
          newMonthlyRateCents: deferredRateCents,
        }
      : null;

    return compareLoanAdjustments(contract, {
      asOfDate,
      specialRepayment: specialOption,
      rateChange: rateOption,
    });
  }, [
    hasAnyAdjustment,
    contract,
    asOfDate,
    isSpecialActive,
    effectiveSpecialCents,
    specialDate,
    repeatYearly,
    isRateActive,
    rateChangeDate,
    deferredRateCents,
  ]);

  React.useEffect(() => {
    onEffectChange?.(effect);
  }, [effect, onEffectChange]);

  const timing = React.useMemo(() => {
    if (!isRateActive || deferredRateCents <= contract.monthlyRateCents) {
      return null;
    }
    const horizonEndDate =
      contract.fixedInterestUntil && contract.fixedInterestUntil > asOfDate
        ? contract.fixedInterestUntil
        : effect?.baseline.paidOffDate ??
          effect?.baseline.points[effect.baseline.points.length - 1]?.date ??
          null;
    if (!horizonEndDate || horizonEndDate <= asOfDate) {
      return null;
    }
    return buildRateChangeTimingSeries(contract, {
      asOfDate,
      newMonthlyRateCents: deferredRateCents,
      horizonEndDate,
      maxPoints: 36,
    });
  }, [isRateActive, deferredRateCents, contract, asOfDate, effect]);

  const timingChart = React.useMemo(() => {
    if (!timing || timing.points.length < 2) return null;
    const pts = timing.points.map((p) => ({
      x: isoDateToDayNumber(p.startDate),
      y: p.interestSavedCents,
    }));
    const firstX = pts[0]!.x;
    const lastX = pts[pts.length - 1]!.x;
    const series: LineSeries[] = [
      {
        id: "timing",
        label: "Zinsersparnis nach Startmonat",
        role: "scenario",
        dashed: true,
        points: pts,
      },
    ];
    return {
      series,
      xDomain: [firstX, lastX] as [number, number],
      xTicks: pickDateTicks(firstX, lastX, 5, { variant: "projection" }),
    };
  }, [timing]);

  const selectedRepayment = React.useMemo(() => {
    if (isLumpSum) return null;
    return repaymentBpsFromRate(contract, rateCents);
  }, [isLumpSum, contract, rateCents]);
  const selectedRepaymentBps = selectedRepayment?.bps ?? null;

  const clampedRateSliderEuros = Math.min(
    rateMaxEuros,
    Math.max(rateMinEuros, Math.round(rateCents / 100)),
  );

  const handleReset = () => {
    setSpecialEuros(0);
    setSpecialMonth(defaultNextMonth);
    setRepeatYearly(false);
    setRateCents(contract.monthlyRateCents);
    setRateStartMonth(defaultNextMonth);
    setTimingOpen(false);
  };

  return (
    <div className="border-t border-[var(--border)] pt-3">
      <button
        type="button"
        onClick={() => setSimOpen((v) => !v)}
        aria-expanded={simOpen}
        className="flex w-full items-center justify-between text-left text-xs font-medium text-[var(--text-primary)] hover:text-[var(--accent)] outline-hidden focus-visible:ring-[3px] focus-visible:ring-[var(--focus)]"
      >
        <span>Anpassung simulieren</span>
        <CollapseChevron open={simOpen} className="h-4 w-4" />
      </button>

      <Collapse open={simOpen}>
        <div className="mt-3 space-y-4">
          {/* Sondertilgung */}
          <div className="space-y-2.5 rounded-lg border border-[var(--border)] p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-semibold text-[var(--text-primary)]">
                Sondertilgung
              </span>
              {allowance.remainingCents !== null &&
              allowance.status === "allowed" ? (
                <span className="tabular-nums text-2xs text-[var(--text-secondary)]">
                  Frei: {formatWholeEuroDE(allowance.remainingCents)}
                  {allowance.capCents !== null
                    ? ` von ${formatWholeEuroDE(allowance.capCents)}/Jahr`
                    : ""}
                </span>
              ) : null}
            </div>

            {specialDisabledReason ? (
              <p className="text-xs text-[var(--text-secondary)]">
                {specialDisabledReason}
              </p>
            ) : null}

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
                  max={specialMaxEuros}
                  step={100}
                  disabled={specialDisabled}
                  value={Math.min(specialEuros, specialMaxEuros)}
                  style={rangeFillStyle(specialEuros, 0, specialMaxEuros)}
                  onChange={(e) => setSpecialEuros(Number(e.target.value))}
                  className="w-full disabled:opacity-50"
                />
                <input
                  type="number"
                  min={0}
                  max={specialMaxEuros}
                  step={100}
                  disabled={specialDisabled}
                  value={specialDisabled ? 0 : specialEuros}
                  onChange={(e) =>
                    setSpecialEuros(
                      Math.min(
                        specialMaxEuros,
                        Math.max(0, Number(e.target.value) || 0),
                      ),
                    )
                  }
                  aria-label="Sondertilgung Betrag in Euro"
                  className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1.5 text-sm tabular-nums text-[var(--text-primary)] outline-hidden focus-visible:ring-[3px] focus-visible:ring-[var(--focus)] disabled:opacity-50"
                />
              </div>

              <div className="space-y-1.5">
                <label
                  htmlFor={`sr-month-${contract.id}`}
                  className="block text-xs text-[var(--text-secondary)]"
                >
                  Monat
                </label>
                <MonthPicker
                  id={`sr-month-${contract.id}`}
                  min={minMonth}
                  disabled={specialDisabled}
                  value={safeSpecialMonth}
                  onChange={setSpecialMonth}
                />
                <label className="flex items-center gap-2 pt-1 text-xs text-[var(--text-primary)]">
                  <input
                    type="checkbox"
                    disabled={specialDisabled}
                    checked={repeatYearly}
                    onChange={(e) => setRepeatYearly(e.target.checked)}
                    className="rounded border-[var(--border)] accent-[var(--accent)] disabled:opacity-50"
                  />
                  jährlich wiederholen
                  <InfoTip
                    id={`sr-repeat-info-${contract.id}`}
                    label="Sondertilgung jährlich wiederholen"
                    text="Simuliert dieselbe Sondertilgung jedes Jahr im gewählten Monat erneut, bis der Kredit getilgt ist. Die jährliche Obergrenze deines Sondertilgungsrechts wird dabei berücksichtigt."
                  />
                </label>
              </div>
            </div>

            {allowance.status === "unknown" || allowance.flags.capUnknown ? (
              <p className="text-2xs text-[var(--amber)]">
                Sondertilgungsrecht im Vertrag prüfen.
              </p>
            ) : null}
            {allowance.flags.usageFromOtherYear ? (
              <p className="text-2xs text-[var(--text-secondary)]">
                Hinterlegte Sondertilgungsnutzung stammt aus einem anderen Jahr
                und wird hier nicht abgezogen.
              </p>
            ) : null}
          </div>

          {/* Rate anpassen */}
          {!isLumpSum ? (
            <div className="space-y-2.5 rounded-lg border border-[var(--border)] p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-semibold text-[var(--text-primary)]">
                  Rate anpassen
                </span>
                {!rateDisabled &&
                corridor.minMonthlyCents !== null &&
                corridor.maxMonthlyCents !== null ? (
                  <span className="tabular-nums text-2xs text-[var(--text-secondary)]">
                    Korridor: {formatWholeEuroDE(rateMinCents)} –{" "}
                    {formatWholeEuroDE(rateMaxCents)}/Monat
                  </span>
                ) : null}
              </div>

              {rateDisabledReason ? (
                <p className="text-xs text-[var(--text-secondary)]">
                  {rateDisabledReason}
                </p>
              ) : null}

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <label
                    htmlFor={`rate-amount-${contract.id}`}
                    className="block text-xs text-[var(--text-secondary)]"
                  >
                    Neue Monatsrate (€)
                  </label>
                  <input
                    id={`rate-amount-${contract.id}`}
                    type="range"
                    min={rateMinEuros}
                    max={rateMaxEuros}
                    step={10}
                    disabled={rateDisabled}
                    value={clampedRateSliderEuros}
                    style={rangeFillStyle(clampedRateSliderEuros, rateMinEuros, rateMaxEuros)}
                    onChange={(e) => setRateCents(Number(e.target.value) * 100)}
                    className="w-full disabled:opacity-50"
                  />
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      min={rateMinEuros}
                      max={rateMaxEuros}
                      step={10}
                      disabled={rateDisabled}
                      value={
                        rateDisabled
                          ? currentRateEuros
                          : Math.round(rateCents / 100)
                      }
                      onChange={(e) => {
                        const raw = Number(e.target.value);
                        if (!Number.isFinite(raw)) return;
                        const cents = Math.round(raw * 100);
                        setRateCents(
                          Math.min(rateMaxCents, Math.max(rateMinCents, cents)),
                        );
                      }}
                      aria-label="Neue Monatsrate in Euro"
                      className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1.5 text-sm tabular-nums text-[var(--text-primary)] outline-hidden focus-visible:ring-[3px] focus-visible:ring-[var(--focus)] disabled:opacity-50"
                    />
                  </div>
                  {selectedRepaymentBps !== null ? (
                    <p className="tabular-nums text-2xs text-[var(--text-secondary)]">
                      Entspricht ≈ {formatBpsDE(selectedRepaymentBps)} Tilgung
                      {corridor.flags.approximatedBase
                        ? " (Näherung über Restschuld)"
                        : ""}
                    </p>
                  ) : null}
                </div>

                <div className="space-y-1.5">
                  <label
                    htmlFor={`rate-month-${contract.id}`}
                    className="block text-xs text-[var(--text-secondary)]"
                  >
                    Startmonat
                  </label>
                  <MonthPicker
                    id={`rate-month-${contract.id}`}
                    min={defaultNextMonth}
                    max={latestChangeMonth}
                    disabled={rateDisabled}
                    value={safeRateStartMonth}
                    onChange={setRateStartMonth}
                  />
                  {corridor.remainingChanges !== null ? (
                    <p className="tabular-nums text-2xs text-[var(--text-secondary)]">
                      Wechsel übrig: {corridor.remainingChanges}
                    </p>
                  ) : null}
                </div>
              </div>

              {!rateDisabled && corridor.flags.corridorAssumed ? (
                <p className="text-2xs text-[var(--amber)]">
                  Korridor angenommen (1–10 % Tilgung) – im Vertrag prüfen.
                </p>
              ) : null}
              {!rateDisabled && corridor.flags.perYearUsageUntracked ? (
                <p className="text-2xs text-[var(--text-secondary)]">
                  Wechsel gelten pro Jahr – Verbrauch im laufenden Jahr im
                  Vertrag prüfen.
                </p>
              ) : null}
            </div>
          ) : null}

          {/* Actions row */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Link
              href={buildPlanningHref("geld", "vergleich", {
                kredit: contract.id,
              })}
              className="inline-flex items-center gap-1 text-xs font-medium text-[var(--accent)] hover:underline"
            >
              <span>Mit ETF vergleichen</span>
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>

            {hasAnyAdjustment ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={handleReset}
              >
                <RotateCcw className="mr-1 h-3.5 w-3.5" />
                Zurücksetzen
              </Button>
            ) : null}
          </div>

          {/* Modeled Effect Card */}
          {effect ? (
            <div className="space-y-2.5 rounded-xl border border-dashed border-[var(--border-sub)] bg-[var(--surface-elevated)]/40 p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium text-[var(--text-primary)]">
                  Simulierte Wirkung
                </span>
                <StatusBadge variant="modeled" label="Modelliert" />
              </div>

              <div className="space-y-1 text-xs tabular-nums text-[var(--text-primary)]">
                {effect.balanceAtFixedEndDeltaCents !== null ? (
                  <p>
                    Restschuld zum Zinsbindungsende{" "}
                    {(() => {
                      const delta = formatSignedDeltaCents(
                        effect.balanceAtFixedEndDeltaCents,
                        true,
                      );
                      return (
                        <span className={`font-semibold ${delta.toneClass}`}>
                          {delta.text}
                        </span>
                      );
                    })()}
                  </p>
                ) : null}

                {effect.interestSavedUntilFixedEndCents !== null ? (
                  <p>
                    Zinsen bis Zinsbindungsende{" "}
                    <span
                      className={`font-semibold ${
                        effect.interestSavedUntilFixedEndCents >= 0
                          ? "text-[var(--emerald)]"
                          : "text-[var(--rose)]"
                      }`}
                    >
                      {effect.interestSavedUntilFixedEndCents >= 0
                        ? `${formatCentsDE(effect.interestSavedUntilFixedEndCents)} gespart`
                        : `${formatCentsDE(Math.abs(effect.interestSavedUntilFixedEndCents))} mehr`}
                    </span>{" "}
                    (gesamt{" "}
                    {effect.interestSavedTotalCents >= 0
                      ? `${formatCentsDE(effect.interestSavedTotalCents)} gespart`
                      : `${formatCentsDE(Math.abs(effect.interestSavedTotalCents))} mehr`}
                    )
                  </p>
                ) : (
                  <p>
                    Gesparte Zinsen gesamt{" "}
                    <span
                      className={`font-semibold ${
                        effect.interestSavedTotalCents >= 0
                          ? "text-[var(--emerald)]"
                          : "text-[var(--rose)]"
                      }`}
                    >
                      {effect.interestSavedTotalCents >= 0
                        ? formatCentsDE(effect.interestSavedTotalCents)
                        : `+${formatCentsDE(Math.abs(effect.interestSavedTotalCents))} Mehrkosten`}
                    </span>
                  </p>
                )}

                <p>
                  Laufzeit{" "}
                  {effect.monthsSaved !== null ? (
                    <span
                      className={`font-semibold ${
                        effect.monthsSaved >= 0
                          ? "text-[var(--emerald)]"
                          : "text-[var(--rose)]"
                      }`}
                    >
                      {effect.monthsSaved >= 0
                        ? `−${formatDurationMonthsDE(effect.monthsSaved)}`
                        : `+${formatDurationMonthsDE(Math.abs(effect.monthsSaved))}`}
                    </span>
                  ) : (
                    "nicht absehbar"
                  )}
                </p>

                <p>
                  {effect.extraPaidUntilFixedEndCents !== null
                    ? "Mehrzahlung bis Zinsbindungsende "
                    : "Mehrzahlung gesamt "}
                  <span className="font-semibold">
                    {formatSignedCashDeltaCents(
                      effect.extraPaidUntilFixedEndCents ??
                        effect.extraPaidTotalCents,
                    )}
                  </span>
                </p>
              </div>

              {timing?.costPerYearDelayCents != null &&
              timing.costPerYearDelayCents > 0 ? (
                <p className="text-xs text-[var(--text-secondary)]">
                  Jedes Jahr später kostet ca.{" "}
                  <span className="tabular-nums font-medium text-[var(--text-primary)]">
                    {formatWholeEuroDE(timing.costPerYearDelayCents)}
                  </span>{" "}
                  Zinsersparnis.
                </p>
              ) : null}

              {/* Timing Mini-Chart behind Erweitert */}
              {timingChart ? (
                <div className="border-t border-[var(--border)]/60 pt-2">
                  <button
                    type="button"
                    onClick={() => setTimingOpen((v) => !v)}
                    aria-expanded={timingOpen}
                    className="flex items-center gap-1 text-2xs font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                  >
                    <CollapseChevron open={timingOpen} className="h-3.5 w-3.5" />
                    <span>Erweitert: Effekt nach Startmonat</span>
                  </button>
                  <Collapse open={timingOpen}>
                    <div className="mt-2">
                      <LineChart
                        series={timingChart.series}
                        xDomain={timingChart.xDomain}
                        xTicks={timingChart.xTicks}
                        xTooltipLabel={(x) =>
                          formatMonthYearDE(dayNumberToIsoDate(Math.round(x)))
                        }
                        height={150}
                        ariaLabel={`Zinsersparnis je Startmonat für ${contract.name}`}
                      />
                    </div>
                  </Collapse>
                </div>
              ) : null}

              {/* Domain clamp / overflow notices */}
              <div className="space-y-1 text-2xs text-[var(--amber)]">
                {effect.adjusted.special &&
                effect.adjusted.special.capOverflowCents > 0 ? (
                  <p>
                    {formatCentsDE(effect.adjusted.special.capOverflowCents)}{" "}
                    über dem Jahreslimit, nicht angerechnet.
                  </p>
                ) : null}
                {effect.adjusted.special &&
                effect.adjusted.special.exceedsDebtCents > 0 ? (
                  <p>
                    {formatCentsDE(effect.adjusted.special.exceedsDebtCents)}{" "}
                    über der Restschuld, nicht benötigt.
                  </p>
                ) : null}
                {effect.adjusted.special &&
                effect.adjusted.special.afterPayoffIgnoredCents > 0 ? (
                  <p>
                    Zahlung nach Schuldenfreiheit (
                    {formatCentsDE(
                      effect.adjusted.special.afterPayoffIgnoredCents,
                    )}
                    ) ignoriert.
                  </p>
                ) : null}
                {effect.adjusted.rateChange?.clamped ? (
                  <p>
                    Rate wurde auf den zulässigen Vertragskorridor (
                    {formatCentsDE(effect.adjusted.rateChange.appliedCents)})
                    begrenzt.
                  </p>
                ) : null}
                {effect.adjusted.rateChange?.notAllowed ? (
                  <p>
                    Ratenänderung laut Vertragsoptionen nicht anwendbar.
                  </p>
                ) : null}
                {effect.adjusted.rateChange?.afterLatestDate ? (
                  <p>
                    Gewählter Startmonat liegt nach dem letztmöglichen
                    Wechseltermin.
                  </p>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>
      </Collapse>
    </div>
  );
}
