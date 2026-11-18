"use client";

import * as React from "react";
import Link from "next/link";
import { StatusBadge } from "@/components/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  formatBpsDE,
  formatCentsDE,
} from "@/lib/domain/money";
import {
  ALLOWED_CHURCH_TAX_BPS,
  DEFAULT_SAVER_ALLOWANCE_CENTS,
  MAX_SAVER_ALLOWANCE_CENTS,
  findBreakEvenReturnBps,
  simulatePrepaymentVsEtf,
  type PrepaymentDefaults,
  type PrepaymentVsEtfInput,
} from "@/lib/domain/scenarios";
import { SliderField } from "./euro-slider-field";
import { formatIsoDateDE } from "./format";
import { ScenarioLineChart } from "./scenario-line-chart";
import { cn } from "@/lib/utils";

export interface LoanOption {
  id: string;
  name: string;
  provider: string | null;
  defaults: PrepaymentDefaults;
}

interface PrepaymentVsEtfCardProps {
  asOfDate: string;
  loanOptions: LoanOption[];
}

function defaultLoanId(options: readonly LoanOption[], asOfDate: string): string {
  const withFuture = options.find((o) => o.defaults.horizonEndDate > asOfDate && !o.defaults.horizonEstimated);
  return (withFuture ?? options[0])?.id ?? "";
}

function Warning({ children }: { children: React.ReactNode }) {
  return (
    <li className="rounded-lg border border-[var(--amber)]/40 bg-[var(--amber)]/10 px-3 py-2 text-xs text-[var(--text-primary)]">
      {children}
    </li>
  );
}

export function PrepaymentVsEtfCard({ asOfDate, loanOptions }: PrepaymentVsEtfCardProps) {
  const [loanId, setLoanId] = React.useState(() => defaultLoanId(loanOptions, asOfDate));
  const [oneTimeCents, setOneTimeCents] = React.useState(1_000_000);
  const [monthlyCents, setMonthlyCents] = React.useState(20_000);
  const [returnBps, setReturnBps] = React.useState(600);
  const [allowanceCents, setAllowanceCents] = React.useState(DEFAULT_SAVER_ALLOWANCE_CENTS);
  const [churchTaxBps, setChurchTaxBps] = React.useState<0 | 800 | 900>(0);
  const [usedThisYearCents, setUsedThisYearCents] = React.useState(0);
  const [horizonOverride, setHorizonOverride] = React.useState<{ loanId: string; date: string } | null>(null);

  const loan = loanOptions.find((o) => o.id === loanId) ?? null;
  const horizonEndDate =
    horizonOverride && horizonOverride.loanId === loanId
      ? horizonOverride.date
      : (loan?.defaults.horizonEndDate ?? asOfDate);

  const dOneTime = React.useDeferredValue(oneTimeCents);
  const dMonthly = React.useDeferredValue(monthlyCents);
  const dReturn = React.useDeferredValue(returnBps);
  const dAllowance = React.useDeferredValue(allowanceCents);
  const dUsed = React.useDeferredValue(usedThisYearCents);
  const dChurchTax = React.useDeferredValue(churchTaxBps);
  const dHorizon = React.useDeferredValue(horizonEndDate);
  const dLoan = React.useDeferredValue(loan);

  // Everything except the ETF return; shared by simulation and break-even.
  const baseInput = React.useMemo(
    () =>
      dLoan
        ? {
            loan: dLoan.defaults.loan,
            startDate: dLoan.defaults.startDate,
            horizonEndDate: dHorizon,
            oneTimeAmountCents: dOneTime,
            monthlyAmountCents: dMonthly,
            specialRepaymentUsedThisYearCents: dUsed,
            saverAllowanceCents: dAllowance,
            churchTaxBps: dChurchTax,
          }
        : null,
    [dLoan, dHorizon, dOneTime, dMonthly, dUsed, dAllowance, dChurchTax],
  );

  const computed = React.useMemo(() => {
    if (!baseInput) return null;
    try {
      const input: PrepaymentVsEtfInput = { ...baseInput, etfAnnualReturnBps: dReturn };
      return { ok: true as const, result: simulatePrepaymentVsEtf(input) };
    } catch (error) {
      return {
        ok: false as const,
        message: error instanceof RangeError ? error.message : "Berechnung nicht möglich.",
      };
    }
  }, [baseInput, dReturn]);

  // Independent of the return slider: not recomputed while dragging it.
  const breakEven = React.useMemo(() => {
    if (!baseInput) return null;
    try {
      return findBreakEvenReturnBps(baseInput);
    } catch {
      return null;
    }
  }, [baseInput]);

  if (loanOptions.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Sondertilgung vs. ETF</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-[var(--text-secondary)]">
          Kein aktiver Kredit vorhanden. Lege zuerst einen Kredit unter{" "}
          <Link href="/vertraege" className="font-medium text-[var(--accent)] underline">
            Verträge
          </Link>{" "}
          an.
        </CardContent>
      </Card>
    );
  }

  const result = computed?.ok ? computed.result : null;
  const headline = result
    ? result.winner === "equal"
      ? "Beide Wege gleichauf"
      : result.winner === "etf"
        ? `ETF-Ansparung liegt bis ${formatIsoDateDE(horizonEndDate)} um ${formatCentsDE(result.netAdvantageEtfCents)} vorn`
        : `Sondertilgung liegt bis ${formatIsoDateDE(horizonEndDate)} um ${formatCentsDE(-result.netAdvantageEtfCents)} vorn`
    : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Sondertilgung vs. ETF</CardTitle>
        <p className="text-sm text-[var(--text-secondary)]">
          Gleiches Monatsbudget in beiden Varianten: Kredit mit Sondertilgungen
          oder regulär weiterlaufen lassen und ins ETF sparen.
        </p>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="planung-loan" className="text-xs font-medium text-[var(--text-secondary)]">
            Kredit
          </label>
          <select
            id="planung-loan"
            value={loanId}
            onChange={(e) => setLoanId(e.target.value)}
            className="h-9 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 text-sm"
          >
            {loanOptions.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
                {o.provider ? ` · ${o.provider}` : ""}
              </option>
            ))}
          </select>
          {loan ? (
            <p className="text-xs tabular-nums text-[var(--text-secondary)]">
              Restschuld (projiziert): {formatCentsDE(loan.defaults.loan.balanceCents)} ·{" "}
              {formatBpsDE(loan.defaults.loan.interestRateBps)} · Rate{" "}
              {formatCentsDE(loan.defaults.loan.monthlyRateCents)}
            </p>
          ) : null}
        </div>

        <div className="grid gap-5 md:grid-cols-2">
          <SliderField id="planung-onetime" label="Einmalbetrag" kind="euro" value={oneTimeCents} min={0} max={5_000_000} step={50_000} onChange={setOneTimeCents} />
          <SliderField id="planung-monthly" label="Monatliche Sparrate" kind="euro" value={monthlyCents} min={0} max={200_000} step={2_500} onChange={setMonthlyCents} />
          <SliderField id="planung-return" label="ETF-Rendite p. a." kind="percent" value={returnBps} min={0} max={1000} step={25} onChange={setReturnBps} />
        </div>

        <details className="rounded-lg border border-[var(--border)] px-4 py-3">
          <summary className="cursor-pointer text-sm font-medium">Erweitert</summary>
          <div className="mt-4 grid gap-5 md:grid-cols-2">
            <SliderField
              id="planung-allowance"
              label="Sparerpauschbetrag verfügbar"
              kind="euro"
              value={allowanceCents}
              min={0}
              max={MAX_SAVER_ALLOWANCE_CENTS}
              step={10_000}
              onChange={(v) => setAllowanceCents(Math.min(MAX_SAVER_ALLOWANCE_CENTS, Math.max(0, v)))}
            />
            <div className="flex flex-col gap-1.5">
              <label htmlFor="planung-kist" className="text-xs font-medium text-[var(--text-secondary)]">
                Kirchensteuer
              </label>
              <select
                id="planung-kist"
                value={churchTaxBps}
                onChange={(e) => setChurchTaxBps(Number(e.target.value) as 0 | 800 | 900)}
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
              value={usedThisYearCents}
              min={0}
              max={5_000_000}
              step={50_000}
              onChange={(v) => setUsedThisYearCents(Math.max(0, v))}
            />
            <div className="flex flex-col gap-1.5">
              <label htmlFor="planung-horizon" className="flex items-center gap-2 text-xs font-medium text-[var(--text-secondary)]">
                Horizont
                {loan?.defaults.horizonEstimated && horizonOverride?.loanId !== loanId ? (
                  <StatusBadge variant="modeled" label="geschätzt" />
                ) : null}
              </label>
              <input
                id="planung-horizon"
                type="date"
                value={horizonEndDate}
                onChange={(e) => {
                  if (e.target.value) setHorizonOverride({ loanId, date: e.target.value });
                }}
                className="h-9 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 text-sm tabular-nums"
              />
            </div>
          </div>
        </details>

        {computed && !computed.ok ? (
          <p role="alert" className="rounded-lg border border-[var(--rose)]/40 bg-[var(--rose)]/10 px-3 py-2 text-xs text-[var(--rose)]">
            Eingabe ungültig: {computed.message}
          </p>
        ) : null}

        {result ? (
          <section
            aria-label="Ergebnis"
            className="flex flex-col gap-4 rounded-xl border border-dashed border-[var(--border-sub)] p-5"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-base font-semibold tracking-tight tabular-nums">{headline}</h3>
              <StatusBadge variant="modeled" />
            </div>

            <dl className="grid gap-4 sm:grid-cols-3">
              <div>
                <dt className="text-xs text-[var(--text-secondary)]">Zinsersparnis (Sondertilgung)</dt>
                <dd className="text-lg font-semibold tabular-nums text-[var(--emerald)]">
                  {formatCentsDE(result.interestSavedCents)}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-[var(--text-secondary)]">ETF netto nach Steuer</dt>
                <dd className="text-lg font-semibold tabular-nums">
                  {formatCentsDE(result.etf.etfTax.netValueCents)}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-[var(--text-secondary)]">Break-even-Rendite</dt>
                <dd className="text-lg font-semibold tabular-nums">
                  {breakEven === null
                    ? "–"
                    : breakEven.kind === "identical"
                      ? "kein Unterschied zwischen den Varianten"
                      : breakEven.kind === "unreachable"
                        ? "nicht erreichbar"
                        : `ETF lohnt ab ${formatBpsDE(breakEven.bps)} p. a.`}
                </dd>
              </div>
            </dl>

            <ul className="flex flex-col gap-2">
              {result.flags.capUnknown ? (
                <Warning>Kein Sondertilgungsrecht hinterlegt – unbegrenzt angenommen.</Warning>
              ) : null}
              {result.flags.rateBelowInterest ? (
                <Warning>Die Rate liegt unter den Monatszinsen – die Restschuld wächst ohne Sondertilgung.</Warning>
              ) : null}
              {result.flags.horizonElapsed ? (
                <Warning>Zinsbindung abgelaufen – es gibt keinen Vergleichszeitraum.</Warning>
              ) : null}
              {result.capLimitedOverflowCents > 0 ? (
                <Warning>
                  Sondertilgung durch den Jahresdeckel gekürzt: {formatCentsDE(result.capLimitedOverflowCents)} fließen
                  stattdessen ins ETF.
                </Warning>
              ) : null}
              <Warning>
                Annahmen: Endbesteuerung beim fiktiven Verkauf am Horizont (Teilfreistellung 30 %); die Vorabpauschale
                ist nicht modelliert und rechnet für das ETF konservativ.
              </Warning>
            </ul>

            <div className={cn("pt-1")}>
              <ScenarioLineChart timeline={result.timeline} />
            </div>
          </section>
        ) : null}
      </CardContent>
    </Card>
  );
}
