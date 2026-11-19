"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowLeft, RotateCcw } from "lucide-react";
import { POT_DEADLINE_BADGE_META } from "@/components/allokation/deadline-labels";
import { StatusBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatBpsDE, formatCentsDE } from "@/lib/domain/money";
import { evaluatePotDeadlines } from "@/lib/domain/pot-deadline";
import {
  calculateHouseholdImpact,
  calculatePropertyPurchase,
  evaluateEquitySource,
  type PropertyPurchaseInput,
} from "@/lib/domain/property-purchase";
import { CURRENT_PURCHASE_COST_RULE_SET } from "@/lib/domain/property-purchase-defaults";
import { buildPurchaseDraftSearchParams } from "@/lib/validation/property-draft";
import { validatePropertyPurchaseForm } from "@/lib/validation/property-purchase";
import { cn } from "@/lib/utils";
import { SliderField } from "./euro-slider-field";
import { formatIsoDateDE } from "./format";
import {
  buildBreakdownSegments,
  buildInitialFormState,
  buildPurchaseHints,
  defaultEquityForPot,
  formatBreakEvenEquityText,
  getExampleDefaultPurchaseCostsCents,
  pickDefaultEquityPot,
  type EquityPotOption,
} from "./purchase-calculator-state";
import { buildPropertyVsEtfHrefFromPurchase } from "./property-vs-etf-query";

interface PurchaseCalculatorWorkspaceProps {
  asOfDate: string;
  monthlySurplusCents: number;
  hasHouseholdData: boolean;
  isDummy: boolean;
  pots: EquityPotOption[];
}

function formatYield(bps: number | null): string {
  return bps === null ? "–" : formatBpsDE(bps);
}

function bpsToPercentWidth(bps: number): string {
  return `${(bps / 100).toFixed(2)}%`;
}

export function PurchaseCalculatorWorkspace({
  asOfDate,
  monthlySurplusCents,
  hasHouseholdData,
  isDummy,
  pots,
}: PurchaseCalculatorWorkspaceProps) {
  const defaultPot = React.useMemo(() => pickDefaultEquityPot(pots), [pots]);
  const fallbackEquityCents = React.useMemo(
    () => getExampleDefaultPurchaseCostsCents(),
    [],
  );

  const [selectedPotId, setSelectedPotId] = React.useState<string>(
    () => defaultPot?.id ?? "",
  );
  const [equityAdoptedFromPot, setEquityAdoptedFromPot] = React.useState<string | null>(
    () => defaultPot?.name ?? null,
  );
  const [form, setForm] = React.useState<PropertyPurchaseInput>(() =>
    buildInitialFormState(defaultEquityForPot(defaultPot, fallbackEquityCents)),
  );

  const deferredForm = React.useDeferredValue(form);

  const deadlines = React.useMemo(
    () =>
      evaluatePotDeadlines({
        pots,
        monthlySurplusCents,
        todayIsoDate: asOfDate,
      }),
    [pots, monthlySurplusCents, asOfDate],
  );

  const selectedPot = React.useMemo(
    () => pots.find((p) => p.id === selectedPotId) ?? null,
    [pots, selectedPotId],
  );

  const computed = React.useMemo(() => {
    const validation = validatePropertyPurchaseForm(deferredForm);
    if (!validation.ok) {
      return { ok: false as const, fieldErrors: validation.fieldErrors };
    }
    try {
      const result = calculatePropertyPurchase(validation.input);
      return { ok: true as const, input: validation.input, result };
    } catch (error) {
      return {
        ok: false as const,
        fieldErrors: {
          _form:
            error instanceof RangeError
              ? error.message
              : "Berechnung nicht möglich.",
        },
      };
    }
  }, [deferredForm]);

  const equitySource = React.useMemo(() => {
    if (!computed.ok) return null;
    return evaluateEquitySource({
      requiredEquityCents: computed.result.equity.requiredCents,
      pot: selectedPot,
      deadlines,
    });
  }, [computed, selectedPot, deadlines]);

  const householdImpact = React.useMemo(() => {
    if (!computed.ok) return null;
    return calculateHouseholdImpact(
      monthlySurplusCents,
      computed.result.cashflow.monthlyCashflowCents,
    );
  }, [computed, monthlySurplusCents]);

  const hints = React.useMemo(() => {
    if (!computed.ok) return [];
    return buildPurchaseHints(computed.result, equitySource, {
      hasHouseholdData,
      isDummy,
    });
  }, [computed, equitySource, hasHouseholdData, isDummy]);

  const breakdown = React.useMemo(() => {
    if (!computed.ok) return null;
    return buildBreakdownSegments(computed.result, computed.input);
  }, [computed]);

  function handlePotChange(potId: string) {
    setSelectedPotId(potId);
    const pot = pots.find((p) => p.id === potId) ?? null;
    if (pot) {
      setForm((prev) => ({
        ...prev,
        equityCents: defaultEquityForPot(pot, fallbackEquityCents),
      }));
      setEquityAdoptedFromPot(pot.name);
    } else {
      setEquityAdoptedFromPot(null);
    }
  }

  function handleReset() {
    setSelectedPotId(defaultPot?.id ?? "");
    setEquityAdoptedFromPot(defaultPot?.name ?? null);
    setForm(
      buildInitialFormState(
        defaultEquityForPot(defaultPot, fallbackEquityCents),
      ),
    );
  }

  const ruleSetItemsByKey = React.useMemo(
    () =>
      new Map(CURRENT_PURCHASE_COST_RULE_SET.items.map((item) => [item.key, item])),
    [],
  );

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <div>
          <Link
            href="/planung"
            className="inline-flex items-center gap-1.5 text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
          >
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
            Planung
          </Link>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-col gap-1">
            <h1 className="text-xl font-semibold tracking-tight">
              Immobilien-Kaufrechner
            </h1>
            <p className="text-sm text-[var(--text-secondary)]">
              Reine Simulation – verändert keine gespeicherten Daten. Alle Werte vor Steuern.
            </p>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={handleReset}>
            <RotateCcw className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
            Zurücksetzen
          </Button>
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-12">
        {/* Eingaben */}
        <div className="flex flex-col gap-5 lg:col-span-6">
          <Card>
            <CardHeader>
              <CardTitle>Kaufpreis &amp; Eigenkapital</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-5">
              <SliderField
                id="kp-price"
                label="Kaufpreis"
                kind="euro"
                value={form.purchasePriceCents}
                min={0}
                max={100_000_000}
                step={500_000}
                onChange={(v) =>
                  setForm((prev) => ({ ...prev, purchasePriceCents: v }))
                }
              />

              <div className="flex flex-col gap-2">
                <label
                  htmlFor="kp-pot"
                  className="text-xs font-medium text-[var(--text-secondary)]"
                >
                  Eigenkapital-Topf (optional)
                </label>
                <select
                  id="kp-pot"
                  value={selectedPotId}
                  onChange={(e) => handlePotChange(e.target.value)}
                  className="h-9 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 text-sm"
                >
                  <option value="">Kein Topf</option>
                  {pots.map((pot) => (
                    <option key={pot.id} value={pot.id}>
                      {pot.name} ({formatCentsDE(pot.currentCents)})
                    </option>
                  ))}
                </select>
                {equityAdoptedFromPot ? (
                  <p className="text-xs text-[var(--text-secondary)]">
                    aus Topf „{equityAdoptedFromPot}“ übernommen
                  </p>
                ) : null}
              </div>

              <SliderField
                id="kp-equity"
                label="Eingesetztes Eigenkapital"
                kind="euro"
                value={form.equityCents}
                min={0}
                max={50_000_000}
                step={100_000}
                onChange={(v) => {
                  setEquityAdoptedFromPot(null);
                  setForm((prev) => ({ ...prev, equityCents: v }));
                }}
              />

              <label className="flex items-start gap-2.5 text-sm">
                <input
                  type="checkbox"
                  checked={form.requireEquityCoversCosts}
                  onChange={(e) =>
                    setForm((prev) => ({
                      ...prev,
                      requireEquityCoversCosts: e.target.checked,
                    }))
                  }
                  className="mt-0.5 h-4 w-4 rounded border-[var(--border)] accent-[var(--accent)]"
                />
                <span className="flex flex-col gap-0.5">
                  <span className="font-medium text-[var(--text-primary)]">
                    Eigenkapital deckt mindestens die Nebenkosten
                  </span>
                  <span className="text-xs text-[var(--text-secondary)]">
                    Üblich bei Bankfinanzierungen; ohne Schalter wird eine Vollfinanzierung inkl. Nebenkosten gerechnet.
                  </span>
                </span>
              </label>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Finanzierung</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-5">
              <SliderField
                id="kp-interest"
                label="Sollzinssatz p. a."
                kind="percent"
                value={form.interestRateBps}
                min={0}
                max={1_000}
                step={5}
                onChange={(v) =>
                  setForm((prev) => ({ ...prev, interestRateBps: v }))
                }
              />
              <SliderField
                id="kp-repayment"
                label="Anfängliche Tilgung p. a."
                kind="percent"
                value={form.initialRepaymentBps}
                min={0}
                max={1_000}
                step={5}
                onChange={(v) =>
                  setForm((prev) => ({ ...prev, initialRepaymentBps: v }))
                }
              />
              <SliderField
                id="kp-years"
                label="Zinsbindung"
                kind="years"
                value={form.fixedRateYears}
                min={1}
                max={40}
                step={1}
                onChange={(v) =>
                  setForm((prev) => ({ ...prev, fixedRateYears: v }))
                }
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Miete &amp; laufende Objektkosten</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-5">
              <SliderField
                id="kp-rent"
                label="Monatliche Kaltmiete"
                kind="euro"
                value={form.monthlyColdRentCents}
                min={0}
                max={500_000}
                step={5_000}
                onChange={(v) =>
                  setForm((prev) => ({ ...prev, monthlyColdRentCents: v }))
                }
              />
              <SliderField
                id="kp-nonrec"
                label="Nicht umlagefähige Kosten / Monat"
                kind="euro"
                value={form.monthlyNonRecoverableCostsCents}
                min={0}
                max={100_000}
                step={1_000}
                onChange={(v) =>
                  setForm((prev) => ({
                    ...prev,
                    monthlyNonRecoverableCostsCents: v,
                  }))
                }
              />
              <SliderField
                id="kp-maint"
                label="Instandhaltungsrücklage / Monat"
                kind="euro"
                value={form.monthlyMaintenanceCents}
                min={0}
                max={100_000}
                step={1_000}
                hint="Faustregel je nach Baujahr/Zustand: ca. 1,00 €/m² im Monat (manuell als Monatsbetrag angesetzt)."
                onChange={(v) =>
                  setForm((prev) => ({ ...prev, monthlyMaintenanceCents: v }))
                }
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Kaufnebenkosten</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-5">
              {form.costItems.map((item, idx) => (
                <SliderField
                  key={item.key}
                  id={`kp-cost-${item.key}`}
                  label={item.label}
                  kind="percent"
                  value={item.bps}
                  min={0}
                  max={1_000}
                  step={5}
                  hint={ruleSetItemsByKey.get(item.key)?.hint}
                  onChange={(bps) =>
                    setForm((prev) => ({
                      ...prev,
                      costItems: prev.costItems.map((entry, i) =>
                        i === idx ? { ...entry, bps } : entry,
                      ),
                    }))
                  }
                />
              ))}
              <p className="text-xs text-[var(--text-secondary)]">
                Richtwerte, Stand{" "}
                <span className="tabular-nums">
                  {formatIsoDateDE(CURRENT_PURCHASE_COST_RULE_SET.reviewedAt)}
                </span>
                , regional abhängig – bitte mit Exposé und Notar prüfen.
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Ergebnis */}
        <div className="lg:col-span-6 lg:sticky lg:top-6 lg:self-start">
          <Card className="border-dashed">
            <CardHeader className="flex flex-row items-center justify-between gap-2">
              <CardTitle>Ergebnis (vor Steuern)</CardTitle>
              <StatusBadge variant="modeled" />
            </CardHeader>
            <CardContent className="flex flex-col gap-5">
              {!computed.ok ? (
                <div
                  role="alert"
                  className="flex flex-col gap-2 rounded-lg border border-[var(--rose)]/40 bg-[var(--rose)]/10 p-4 text-xs text-[var(--rose)]"
                >
                  <p className="font-semibold">Bitte Eingaben prüfen</p>
                  <ul className="list-disc space-y-1 pl-4">
                    {Object.entries(computed.fieldErrors).map(([key, msg]) => (
                      <li key={key}>{msg}</li>
                    ))}
                  </ul>
                </div>
              ) : (
                <>
                  {/* 1. Kosten */}
                  <section aria-label="Kosten" className="flex flex-col gap-2">
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--text-secondary)]">
                      Kosten
                    </h3>
                    <div className="flex justify-between text-sm">
                      <span className="text-[var(--text-secondary)]">Kaufpreis</span>
                      <span className="tabular-nums">
                        {formatCentsDE(computed.input.purchasePriceCents)}
                      </span>
                    </div>
                    {computed.result.costs.items.map((item) => (
                      <div key={item.key} className="flex justify-between text-sm">
                        <span className="text-[var(--text-secondary)]">
                          {item.label} (
                          <span className="tabular-nums">
                            {formatBpsDE(item.bps)}
                          </span>
                          )
                        </span>
                        <span className="tabular-nums">
                          {formatCentsDE(item.amountCents)}
                        </span>
                      </div>
                    ))}
                    <div className="flex justify-between text-sm">
                      <span className="text-[var(--text-secondary)]">
                        Nebenkosten gesamt
                      </span>
                      <span className="tabular-nums">
                        {formatCentsDE(computed.result.costs.purchaseCostsCents)}
                      </span>
                    </div>
                    <div className="flex justify-between border-t border-[var(--border)] pt-2 text-sm font-semibold">
                      <span>Gesamtkosten</span>
                      <span className="tabular-nums">
                        {formatCentsDE(computed.result.costs.totalCostsCents)}
                      </span>
                    </div>
                  </section>

                  {/* 2. Finanzierung */}
                  <section
                    aria-label="Finanzierung"
                    className="flex flex-col gap-2 border-t border-[var(--border)] pt-4"
                  >
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--text-secondary)]">
                      Finanzierung
                    </h3>
                    <div className="flex justify-between text-sm font-semibold">
                      <span>Benötigtes Eigenkapital</span>
                      <span className="tabular-nums">
                        {formatCentsDE(computed.result.equity.requiredCents)}
                      </span>
                    </div>
                    {computed.result.equity.minimumCents > 0 ? (
                      <p className="text-xs text-[var(--text-secondary)] tabular-nums">
                        davon Mindest-EK (Nebenkosten):{" "}
                        {formatCentsDE(computed.result.equity.minimumCents)}
                      </p>
                    ) : null}
                    <div className="flex justify-between text-sm">
                      <span className="text-[var(--text-secondary)]">Darlehen</span>
                      <span className="tabular-nums">
                        {formatCentsDE(computed.result.loan.principalCents)}
                      </span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-[var(--text-secondary)]">
                        Monatsrate (1. Monat:{" "}
                        <span className="tabular-nums">
                          {formatCentsDE(computed.result.loan.firstMonthInterestCents)}
                        </span>{" "}
                        Zins /{" "}
                        <span className="tabular-nums">
                          {formatCentsDE(computed.result.loan.firstMonthPrincipalCents)}
                        </span>{" "}
                        Tilgung)
                      </span>
                      <span className="font-medium tabular-nums">
                        {formatCentsDE(computed.result.loan.monthlyRateCents)}
                      </span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-[var(--text-secondary)]">
                        Restschuld nach{" "}
                        <span className="tabular-nums">
                          {computed.input.fixedRateYears}
                        </span>{" "}
                        Jahren
                      </span>
                      <span className="tabular-nums">
                        {formatCentsDE(computed.result.loan.remainingDebtCents)}
                      </span>
                    </div>
                    {computed.result.loan.paidOffInMonth !== null ? (
                      <p className="text-xs text-[var(--emerald)] tabular-nums">
                        getilgt nach {computed.result.loan.paidOffInMonth} Monaten
                      </p>
                    ) : null}
                  </section>

                  {/* 3. Objekt-Cashflow vor Steuern */}
                  <section
                    aria-label="Objekt-Cashflow vor Steuern"
                    className="flex flex-col gap-3 border-t border-[var(--border)] pt-4"
                  >
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--text-secondary)]">
                      Objekt-Cashflow vor Steuern
                    </h3>
                    <div className="flex items-baseline justify-between">
                      <span className="text-sm text-[var(--text-secondary)]">
                        Monatlicher Cashflow
                      </span>
                      <span
                        className={cn(
                          "text-lg font-semibold tabular-nums",
                          computed.result.cashflow.monthlyCashflowCents >= 0
                            ? "text-[var(--emerald)]"
                            : "text-[var(--rose)]",
                        )}
                      >
                        {formatCentsDE(
                          computed.result.cashflow.monthlyCashflowCents,
                          { showPlusSign: true },
                        )}
                      </span>
                    </div>
                    <div className="flex flex-wrap justify-between gap-2 text-xs text-[var(--text-secondary)] tabular-nums">
                      <span>
                        Brutto-Mietrendite:{" "}
                        <strong className="text-[var(--text-primary)]">
                          {formatYield(computed.result.yields.grossYieldBps)}
                        </strong>
                      </span>
                      <span>
                        Netto-Mietrendite:{" "}
                        <strong className="text-[var(--text-primary)]">
                          {formatYield(computed.result.yields.netYieldBps)}
                        </strong>
                      </span>
                    </div>

                    {breakdown ? (
                      <div className="flex flex-col gap-2 rounded-lg bg-[var(--surface-elevated)] p-3">
                        <div className="flex flex-col gap-1">
                          <div className="flex justify-between text-xs text-[var(--text-secondary)]">
                            <span>Kaltmiete</span>
                            <span className="tabular-nums">
                              {formatCentsDE(breakdown.rentCents)}
                            </span>
                          </div>
                          <div className="h-2.5 w-full overflow-hidden rounded-md bg-[var(--border)]">
                            <div
                              className="h-full bg-[var(--emerald)]"
                              style={{
                                width: bpsToPercentWidth(breakdown.rentWidthBps),
                              }}
                            />
                          </div>
                        </div>

                        <div className="flex flex-col gap-1">
                          <div className="flex justify-between text-xs text-[var(--text-secondary)]">
                            <span>Monatliche Abflüsse (1. Monat)</span>
                            <span className="tabular-nums">
                              {formatCentsDE(breakdown.totalOutflowsCents)}
                            </span>
                          </div>
                          <div className="flex h-2.5 w-full overflow-hidden rounded-md bg-[var(--border)]">
                            {breakdown.segments.map((seg) => {
                              const colorClass =
                                seg.key === "interest"
                                  ? "bg-[var(--rose)]"
                                  : seg.key === "principal"
                                    ? "bg-[var(--sky)]"
                                    : seg.key === "non_recoverable"
                                      ? "bg-[var(--text-secondary)]/70"
                                      : "bg-[var(--text-secondary)]/40";
                              return (
                                <div
                                  key={seg.key}
                                  className={cn("h-full", colorClass)}
                                  style={{ width: bpsToPercentWidth(seg.widthBps) }}
                                  title={`${seg.label}: ${formatCentsDE(seg.amountCents)}`}
                                />
                              );
                            })}
                          </div>
                        </div>

                        <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-[var(--text-secondary)] tabular-nums">
                          <span className="inline-flex items-center gap-1">
                            <span className="h-2 w-2 rounded-full bg-[var(--rose)]" />
                            Zins: {formatCentsDE(computed.result.loan.firstMonthInterestCents)}
                          </span>
                          <span className="inline-flex items-center gap-1">
                            <span className="h-2 w-2 rounded-full bg-[var(--sky)]" />
                            Tilgung: {formatCentsDE(computed.result.loan.firstMonthPrincipalCents)}
                          </span>
                          <span className="inline-flex items-center gap-1">
                            <span className="h-2 w-2 rounded-full bg-[var(--text-secondary)]/70" />
                            Nicht uml.: {formatCentsDE(computed.input.monthlyNonRecoverableCostsCents)}
                          </span>
                          <span className="inline-flex items-center gap-1">
                            <span className="h-2 w-2 rounded-full bg-[var(--text-secondary)]/40" />
                            Instandh.: {formatCentsDE(computed.input.monthlyMaintenanceCents)}
                          </span>
                        </div>
                      </div>
                    ) : null}
                  </section>

                  {/* 4. Break-even */}
                  <section
                    aria-label="Break-even"
                    className="flex flex-col gap-2 border-t border-[var(--border)] pt-4"
                  >
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--text-secondary)]">
                      Break-even (Cashflow ≥ 0 inkl. Tilgung)
                    </h3>
                    <div className="flex justify-between text-sm">
                      <span className="text-[var(--text-secondary)]">
                        Break-even-Kaltmiete
                      </span>
                      <span className="font-medium tabular-nums">
                        {formatCentsDE(
                          computed.result.breakEven.monthlyColdRentCents,
                        )}
                      </span>
                    </div>
                    <div className="flex justify-between gap-3 text-sm">
                      <span className="text-[var(--text-secondary)]">
                        Break-even-Eigenkapital
                      </span>
                      <span className="text-right tabular-nums">
                        {formatBreakEvenEquityText(computed.result.breakEven)}
                      </span>
                    </div>
                  </section>

                  {/* 5. Bestand */}
                  <section
                    aria-label="Bestand"
                    className="flex flex-col gap-2.5 border-t border-[var(--border)] pt-4"
                  >
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--text-secondary)]">
                      Bestand &amp; Haushaltsauswirkung
                    </h3>
                    {equitySource ? (
                      <div className="flex flex-col gap-1 rounded-lg border border-[var(--border)] p-3 text-xs">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="font-medium text-[var(--text-primary)]">
                            EK-Topf: {equitySource.potName}
                          </span>
                          {equitySource.deadline ? (
                            <Badge
                              variant="outline"
                              className={
                                POT_DEADLINE_BADGE_META[
                                  equitySource.deadline.status
                                ].className
                              }
                            >
                              {
                                POT_DEADLINE_BADGE_META[
                                  equitySource.deadline.status
                                ].label
                              }
                            </Badge>
                          ) : null}
                        </div>
                        <div className="flex justify-between text-[var(--text-secondary)] tabular-nums">
                          <span>Stand heute</span>
                          <span>{formatCentsDE(equitySource.currentCents)}</span>
                        </div>
                        <div className="flex justify-between text-[var(--text-secondary)] tabular-nums">
                          <span>Lücke zum benötigten EK</span>
                          <span>
                            {equitySource.coveredNow
                              ? "gedeckt"
                              : formatCentsDE(equitySource.gapNowCents)}
                          </span>
                        </div>
                      </div>
                    ) : null}

                    {householdImpact ? (
                      <div className="flex flex-col gap-1 text-sm">
                        <div className="flex justify-between">
                          <span className="text-[var(--text-secondary)]">
                            Was bleibt übrig? (Überschuss heute → nach Kauf)
                          </span>
                          <span className="tabular-nums">
                            {formatCentsDE(
                              householdImpact.monthlySurplusBeforeCents,
                            )}{" "}
                            →{" "}
                            <strong
                              className={cn(
                                householdImpact.isDeficitAfter
                                  ? "text-[var(--rose)]"
                                  : "text-[var(--text-primary)]",
                              )}
                            >
                              {formatCentsDE(
                                householdImpact.monthlySurplusAfterCents,
                              )}
                            </strong>
                          </span>
                        </div>
                      </div>
                    ) : null}
                  </section>

                  {/* Hinweise */}
                  {hints.length > 0 ? (
                    <ul className="flex flex-col gap-2 border-t border-[var(--border)] pt-4">
                      {hints.map((hint) => (
                        <li
                          key={hint.key}
                          className="rounded-lg border border-[var(--amber)]/40 bg-[var(--amber)]/10 px-3 py-2 text-xs text-[var(--text-primary)]"
                        >
                          {hint.text}
                        </li>
                      ))}
                    </ul>
                  ) : null}

                  <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--border)] pt-4">
                    <span className="text-xs text-[var(--text-secondary)]">
                      öffnet einen Entwurf, gespeichert wird erst nach Bestätigung
                    </span>
                    <Link
                      href={`/vertraege?${buildPurchaseDraftSearchParams(computed.input, computed.result).toString()}`}
                      className="inline-flex items-center rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3.5 py-2 text-xs font-medium text-[var(--text-primary)] transition-colors hover:bg-[var(--surface-elevated)]"
                    >
                      Als Objekt anlegen
                    </Link>
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs text-[var(--text-secondary)]">
                      öffnet den Vergleich Immobilie vs. ETF, Wohnfläche und Kaltmiete/qm dort ergänzen
                    </span>
                    <Link
                      href={buildPropertyVsEtfHrefFromPurchase(computed.input)}
                      className="inline-flex items-center rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3.5 py-2 text-xs font-medium text-[var(--text-primary)] transition-colors hover:bg-[var(--surface-elevated)]"
                    >
                      Mit ETF vergleichen
                    </Link>
                  </div>
                </>
              )}

              <p className="border-t border-[var(--border)] pt-3 text-xs text-[var(--text-secondary)]">
                Vor Steuern: AfA, Zinsabzug und Steuer auf Mieteinnahmen sind nicht enthalten. Keine Anschlussfinanzierung, Miet- oder Wertentwicklung modelliert.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
