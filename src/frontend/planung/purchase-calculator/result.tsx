"use client";

import Link from "next/link";
import { POT_DEADLINE_BADGE_META } from "@/frontend/allokation/deadline-labels";
import { StatusBadge } from "@/frontend/ui/status-badge";
import { Badge } from "@/frontend/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/frontend/ui/card";
import { formatBpsDE, formatCentsDE } from "@/domain/core/money";
import { buildPurchaseDraftSearchParams } from "@/validation/property-draft";
import { cn } from "@/frontend/ui/cn";
import { formatBreakEvenEquityText } from "../purchase-calculator-state";
import { buildPropertyVsEtfHrefFromPurchase } from "../property-vs-etf-query";
import {
  type PurchaseCalculatorState, bpsToPercentWidth, formatYield,
} from "./use-purchase-calculator";

/** Ergebnis des Kaufrechners: Finanzierungsbedarf, Rate und Wirkung auf den Haushalt. */
export function PurchaseCalculatorResult({ ws }: { ws: PurchaseCalculatorState }) {
  const { breakdown, computed, equitySource, hints, householdImpact } = ws;
  return (
    <>
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
                  <h3 className="section-label text-[var(--text-secondary)]">
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
                  <h3 className="section-label text-[var(--text-secondary)]">
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
                  <h3 className="section-label text-[var(--text-secondary)]">
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

                      <div className="flex flex-wrap gap-x-3 gap-y-1 text-2xs text-[var(--text-secondary)] tabular-nums">
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
                  <h3 className="section-label text-[var(--text-secondary)]">
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
                  <h3 className="section-label text-[var(--text-secondary)]">
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
    </>
  );
}
