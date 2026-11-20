"use client";

import { formatMonthDE } from "@/domain/core/date-format";
import * as React from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";
import { Button } from "@/frontend/ui/button";
import { Dialog } from "@/frontend/ui/dialog";
import { Input } from "@/frontend/ui/input";
import { Label } from "@/frontend/ui/label";
import type { PotRow } from "@/backend/db/queries/pots";
import { getTodayIsoDate } from "@/domain/core/date";
import {
  centsToEuroInputString,
  formatCentsDE,
  parseEuroInputToCents,
} from "@/domain/core/money";
import { evaluatePotDeadlines } from "@/domain/allocation/pot-deadline";
import { applyPendingTransfers } from "@/domain/allocation/pot-sync";
import {
  calculateWaterfallSuggestion,
  validateManualWaterfallAllocation,
  type WaterfallMode,
} from "@/domain/allocation/waterfall";
import { cn } from "@/frontend/ui/cn";
import type { AllocationPrefill } from "./allocation-prefill";

interface AllocateModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pots: PotRow[];
  /** Planned but not yet synced transfers of linked pots (cents). */
  pendingTransferCentsByPotId: Record<string, number>;
  monthlySurplusCents: number;
  prefill?: AllocationPrefill | null;
  onAllocated: (result: { transferPlanCount: number }) => void;
}

export function AllocateModal({
  open,
  onOpenChange,
  pots,
  pendingTransferCentsByPotId,
  monthlySurplusCents,
  prefill,
  onAllocated,
}: AllocateModalProps) {
  if (!open) {
    return null;
  }

  // Suggestions and validation use stand + open transfers (calculation only).
  const effectivePots = applyPendingTransfers(
    pots,
    new Map(Object.entries(pendingTransferCentsByPotId)),
  );

  return (
    <AllocateModalInner
      key={`${pots
        .map(
          (p) =>
            `${p.id}:${p.updatedAt}:${pendingTransferCentsByPotId[p.id] ?? 0}`,
        )
        .join("|")}|prefill:${prefill ? prefill.amountCents : "none"}`}
      open={open}
      onOpenChange={onOpenChange}
      pots={effectivePots}
      pendingTransferCentsByPotId={pendingTransferCentsByPotId}
      monthlySurplusCents={monthlySurplusCents}
      prefill={prefill}
      onAllocated={onAllocated}
    />
  );
}

function buildSuggestionMap(
  pots: PotRow[],
  amountCents: number,
  mode: WaterfallMode,
): Record<string, string> {
  try {
    const safeAmount = Math.max(0, amountCents);
    const plan = calculateWaterfallSuggestion(pots, safeAmount, { mode });
    const next: Record<string, string> = {};
    for (const s of plan.suggestions) {
      next[s.potId] = centsToEuroInputString(s.allocatedCents);
    }
    return next;
  } catch {
    const fallback: Record<string, string> = {};
    for (const pot of pots) {
      fallback[pot.id] = "0,00";
    }
    return fallback;
  }
}

function buildPrefillMap(
  pots: PotRow[],
  prefill: AllocationPrefill,
): Record<string, string> {
  const byPot = new Map(prefill.entries.map((e) => [e.potId, e.amountCents]));
  const map: Record<string, string> = {};
  for (const pot of pots) {
    map[pot.id] = centsToEuroInputString(byPot.get(pot.id) ?? 0);
  }
  return map;
}

function AllocateModalInner({
  open,
  onOpenChange,
  pots,
  pendingTransferCentsByPotId,
  monthlySurplusCents,
  prefill,
  onAllocated,
}: AllocateModalProps) {
  const defaultAmountCents = Math.max(0, monthlySurplusCents);

  const [mode, setMode] = React.useState<WaterfallMode>(
    prefill ? "one_time" : "monthly",
  );
  const [amountEuro, setAmountEuro] = React.useState<string>(
    centsToEuroInputString(prefill ? prefill.amountCents : defaultAmountCents),
  );
  const [sourceLabel, setSourceLabel] = React.useState<string>(
    prefill ? "Einmalzufluss" : "Monatsüberschuss",
  );
  const [potInputs, setPotInputs] = React.useState<Record<string, string>>(() =>
    prefill
      ? buildPrefillMap(pots, prefill)
      : buildSuggestionMap(pots, defaultAmountCents, "monthly"),
  );
  const [isManualOverride, setIsManualOverride] = React.useState(
    Boolean(prefill),
  );
  const [submitting, setSubmitting] = React.useState(false);
  const [submitError, setSubmitError] = React.useState<string | null>(null);

  const parsedInputCents = React.useMemo(
    () => parseEuroInputToCents(amountEuro),
    [amountEuro],
  );

  function applyModeSwitch(nextMode: WaterfallMode) {
    setMode(nextMode);
    setSubmitError(null);
    if (nextMode === "monthly") {
      const nextAmount = Math.max(0, monthlySurplusCents);
      setAmountEuro(centsToEuroInputString(nextAmount));
      setSourceLabel("Monatsüberschuss");
      setPotInputs(buildSuggestionMap(pots, nextAmount, "monthly"));
      setIsManualOverride(false);
    } else {
      setSourceLabel("Einmalzufluss");
      const currentValid =
        parsedInputCents !== null && parsedInputCents >= 0
          ? parsedInputCents
          : 0;
      setPotInputs(buildSuggestionMap(pots, currentValid, "one_time"));
      setIsManualOverride(false);
    }
  }

  function handleAmountChange(value: string) {
    setAmountEuro(value);
    setSubmitError(null);
    const parsed = parseEuroInputToCents(value);
    if (parsed !== null && parsed >= 0) {
      setPotInputs(buildSuggestionMap(pots, parsed, mode));
      setIsManualOverride(false);
    }
  }

  function handleResetToSuggestion() {
    const validAmount =
      parsedInputCents !== null && parsedInputCents >= 0 ? parsedInputCents : 0;
    setPotInputs(buildSuggestionMap(pots, validAmount, mode));
    setIsManualOverride(false);
    setSubmitError(null);
  }

  function handlePotInputChange(potId: string, value: string) {
    setPotInputs((prev) => ({ ...prev, [potId]: value }));
    setIsManualOverride(true);
    setSubmitError(null);
  }

  const parsedEntries = React.useMemo(() => {
    let hasInvalid = false;
    const entries: Array<{ potId: string; allocatedCents: number }> = [];
    for (const pot of pots) {
      const raw = potInputs[pot.id] ?? "0,00";
      const parsed = parseEuroInputToCents(raw);
      if (parsed === null || parsed < 0) {
        hasInvalid = true;
        entries.push({ potId: pot.id, allocatedCents: 0 });
      } else {
        entries.push({ potId: pot.id, allocatedCents: parsed });
      }
    }
    return { entries, hasInvalid };
  }, [pots, potInputs]);

  const validationState = React.useMemo(() => {
    const safeInput =
      parsedInputCents !== null && parsedInputCents >= 0 ? parsedInputCents : 0;
    try {
      const result = validateManualWaterfallAllocation(
        pots,
        safeInput,
        parsedEntries.entries,
      );
      return { result, rangeError: null as string | null };
    } catch {
      return {
        result: null,
        rangeError: "Beträge überschreiten den zulässigen Wertebereich.",
      };
    }
  }, [pots, parsedInputCents, parsedEntries.entries]);

  const validation = validationState.result ?? {
    inputAmountCents:
      parsedInputCents !== null && parsedInputCents >= 0 ? parsedInputCents : 0,
    totalAllocatedCents: 0,
    unallocatedCents: 0,
    exceedsInput: false,
    hasPositiveAllocation: false,
    overTargetWarnings: [],
    projectedByPotId: Object.fromEntries(
      pots.map((pot) => [pot.id, pot.currentCents]),
    ),
  };

  const warningByPotId = React.useMemo(() => {
    const map = new Map<string, number>();
    for (const w of validation.overTargetWarnings) {
      map.set(w.potId, w.excessCents);
    }
    return map;
  }, [validation.overTargetWarnings]);

  const deadlineRisks = React.useMemo(() => {
    const projectedPots = pots.map((pot) => ({
      ...pot,
      currentCents: validation.projectedByPotId[pot.id] ?? pot.currentCents,
    }));
    const evals = evaluatePotDeadlines({
      pots: projectedPots,
      monthlySurplusCents,
      todayIsoDate: getTodayIsoDate(),
    });
    return evals.filter((item) => item.status === "at_risk");
  }, [pots, validation.projectedByPotId, monthlySurplusCents]);

  let validationErrorMessage: string | null = null;
  if (parsedInputCents === null || parsedInputCents <= 0) {
    validationErrorMessage =
      "Der zu verteilende Betrag muss größer als 0,00 € sein.";
  } else if (sourceLabel.trim().length === 0) {
    validationErrorMessage = "Bitte eine Quelle für das Journal angeben.";
  } else if (parsedEntries.hasInvalid) {
    validationErrorMessage =
      "Mindestens ein Topf-Betrag ist ungültig (erwartet nicht-negativer Euro-Betrag).";
  } else if (validationState.rangeError !== null) {
    validationErrorMessage = validationState.rangeError;
  } else if (validation.exceedsInput) {
    validationErrorMessage = `Die Summe der Zuteilungen (${formatCentsDE(validation.totalAllocatedCents)}) übersteigt den verfügbaren Betrag (${formatCentsDE(parsedInputCents)}).`;
  } else if (!validation.hasPositiveAllocation) {
    validationErrorMessage =
      "Mindestens ein Topf muss einen Betrag > 0,00 € erhalten.";
  }

  const canSubmit = !submitting && validationErrorMessage === null;

  async function handleConfirm() {
    if (!canSubmit || parsedInputCents === null) {
      return;
    }

    setSubmitting(true);
    setSubmitError(null);

    try {
      const response = await fetch("/api/pots/allocate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          inputAmountCents: parsedInputCents,
          mode,
          sourceLabel: sourceLabel.trim(),
          allocations: parsedEntries.entries.map((e) => ({
            potId: e.potId,
            amountCents: e.allocatedCents,
          })),
        }),
      });

      const payload = (await response.json()) as {
        error?: string;
        transferPlanPotIds?: string[];
      };
      if (!response.ok) {
        setSubmitError(payload.error ?? "Verbuchung fehlgeschlagen.");
        return;
      }

      onAllocated({
        transferPlanCount: payload.transferPlanPotIds?.length ?? 0,
      });
      onOpenChange(false);
    } catch {
      setSubmitError("Netzwerkfehler bei der Verbuchung.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Geld verteilen (Wasserfall)"
      description="Priorisierte Berechnung mit manueller Korrekturmöglichkeit vor der 1-Klick-Verbuchung."
      className="max-w-2xl"
    >
      <div className="space-y-5">
        {prefill ? (
          <p className="rounded-lg border border-[var(--accent)]/35 bg-[var(--accent)]/10 px-3 py-2 text-xs text-[var(--text-primary)]">
            Übernommen aus <em>Wohin mit X €?</em>: nur Topf-Beträge;
            Sondertilgung/ETF erledigst du direkt bei Bank/Depot.
          </p>
        ) : null}
        {/* Schritt 1: Modus, Betrag & Quelle */}
        <div className="space-y-3 rounded-lg border border-[var(--border)] bg-[var(--surface-elevated)] p-3.5">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => applyModeSwitch("monthly")}
              className={cn(
                "rounded-md border px-3 py-1.5 text-xs font-medium transition-colors",
                mode === "monthly"
                  ? "border-[var(--control-edge)] bg-[var(--control)] text-[var(--control-foreground)]"
                  : "border-[var(--border)] bg-[var(--surface)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]",
              )}
            >
              Monatsüberschuss
            </button>
            <button
              type="button"
              onClick={() => applyModeSwitch("one_time")}
              className={cn(
                "rounded-md border px-3 py-1.5 text-xs font-medium transition-colors",
                mode === "one_time"
                  ? "border-[var(--control-edge)] bg-[var(--control)] text-[var(--control-foreground)]"
                  : "border-[var(--border)] bg-[var(--surface)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]",
              )}
            >
              Einmalzufluss
            </button>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="alloc-amount">Verfügbarer Betrag (€)</Label>
              <Input
                id="alloc-amount"
                inputMode="decimal"
                value={amountEuro}
                onChange={(e) => handleAmountChange(e.target.value)}
                className="tabular-nums"
                hasError={parsedInputCents === null || parsedInputCents <= 0}
              />
            </div>

            <div className="space-y-1">
              <Label htmlFor="alloc-source">Quelle (Journal)</Label>
              <Input
                id="alloc-source"
                value={sourceLabel}
                onChange={(e) => setSourceLabel(e.target.value)}
                placeholder="z. B. Monatsüberschuss oder Bonus"
                hasError={sourceLabel.trim().length === 0}
              />
            </div>
          </div>
        </div>

        {/* Schritt 2: Töpfe & manuelle Korrektur */}
        <div className="space-y-2.5">
          <div className="flex items-center justify-between gap-2">
            <h3 className="section-label text-[var(--text-secondary)]">
              Zuteilung nach Priorität
            </h3>
            {isManualOverride ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={handleResetToSuggestion}
              >
                <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                Vorschlag übernehmen
              </Button>
            ) : null}
          </div>

          <div className="divide-y divide-[var(--border)] rounded-lg border border-[var(--border)]">
            {pots.map((pot) => {
              const rawVal = potInputs[pot.id] ?? "0,00";
              const parsedVal = parseEuroInputToCents(rawVal);
              const projected =
                validation.projectedByPotId[pot.id] ?? pot.currentCents;
              const excessCents = warningByPotId.get(pot.id);

              return (
                <div key={pot.id} className="space-y-1.5 px-3.5 py-2.5">
                  <div className="grid grid-cols-1 items-center gap-2 sm:grid-cols-[1fr_130px_130px]">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="tabular-nums text-xs font-semibold text-[var(--text-secondary)]">
                          #{pot.priority}
                        </span>
                        <span className="truncate text-sm font-medium text-[var(--text-primary)]">
                          {pot.name}
                        </span>
                        {pot.externalLinkKind !== null ? (
                          <span className="shrink-0 rounded-md border border-solid border-[var(--emerald)]/35 bg-[var(--emerald)]/10 px-1.5 py-0.5 text-2xs font-medium text-[var(--emerald)]">
                            Überweisung
                          </span>
                        ) : (
                          <span className="shrink-0 rounded-md border border-dashed border-[var(--border-sub)] px-1.5 py-0.5 text-2xs font-medium text-[var(--text-secondary)]">
                            Buchung
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-[var(--text-secondary)]">
                        Aktuell:{" "}
                        <span className="tabular-nums">
                          {formatCentsDE(
                            pot.currentCents -
                              (pendingTransferCentsByPotId[pot.id] ?? 0),
                          )}
                        </span>
                        {(pendingTransferCentsByPotId[pot.id] ?? 0) > 0 ? (
                          <>
                            {" "}
                            · davon unterwegs:{" "}
                            <span className="tabular-nums">
                              {formatCentsDE(
                                pendingTransferCentsByPotId[pot.id] ?? 0,
                              )}
                            </span>
                          </>
                        ) : null}
                        {pot.targetCents !== null ? (
                          <>
                            {" "}
                            / Ziel:{" "}
                            <span className="tabular-nums">
                              {formatCentsDE(pot.targetCents)}
                            </span>
                          </>
                        ) : null}
                      </p>
                      {mode === "one_time" &&
                      pot.ruleType === "fixed_monthly" ? (
                        <p className="text-2xs text-[var(--text-secondary)]">
                          Wird bei Einmalzufluss übersprungen (0,00 €)
                        </p>
                      ) : null}
                    </div>

                    <div>
                      <Label htmlFor={`alloc-pot-${pot.id}`} className="sr-only">
                        Zuteilung für {pot.name}
                      </Label>
                      <Input
                        id={`alloc-pot-${pot.id}`}
                        inputMode="decimal"
                        value={rawVal}
                        onChange={(e) =>
                          handlePotInputChange(pot.id, e.target.value)
                        }
                        className="h-8 text-right tabular-nums"
                        hasError={parsedVal === null || parsedVal < 0}
                      />
                    </div>

                    <div className="text-right">
                      <div className="text-2xs text-[var(--text-secondary)]">
                        Neuer Stand
                      </div>
                      <div className="tabular-nums text-sm font-semibold text-[var(--text-primary)]">
                        {formatCentsDE(projected)}
                      </div>
                    </div>
                  </div>

                  {excessCents !== undefined ? (
                    <div className="flex items-center gap-1.5 text-xs text-[var(--amber)]">
                      <AlertTriangle
                        className="h-3.5 w-3.5 shrink-0"
                        aria-hidden="true"
                      />
                      <span>
                        Übersteigt Zielwert um{" "}
                        <span className="tabular-nums font-medium">
                          {formatCentsDE(excessCents)}
                        </span>{" "}
                        (Verbuchung bleibt möglich).
                      </span>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>

        {/* Summenzeile */}
        <div className="grid grid-cols-3 gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface-elevated)] px-3.5 py-2.5 text-xs">
          <div>
            <div className="text-[var(--text-secondary)]">Verteilt</div>
            <div
              className={cn(
                "tabular-nums text-sm font-semibold",
                validation.exceedsInput
                  ? "text-[var(--rose)]"
                  : "text-[var(--emerald)]",
              )}
            >
              {formatCentsDE(validation.totalAllocatedCents)}
            </div>
          </div>
          <div>
            <div className="text-[var(--text-secondary)]">Verfügbar</div>
            <div className="tabular-nums text-sm font-semibold text-[var(--text-primary)]">
              {parsedInputCents !== null && parsedInputCents >= 0
                ? formatCentsDE(parsedInputCents)
                : "–"}
            </div>
          </div>
          <div className="text-right">
            <div className="text-[var(--text-secondary)]">Nicht zugeteilt</div>
            <div
              className={cn(
                "tabular-nums text-sm font-semibold",
                validation.unallocatedCents < 0
                  ? "text-[var(--rose)]"
                  : "text-[var(--text-primary)]",
              )}
            >
              {formatCentsDE(validation.unallocatedCents)}
            </div>
          </div>
        </div>

        {deadlineRisks.length > 0 ? (
          <div className="rounded-lg border border-[var(--amber)]/40 bg-[var(--amber)]/5 px-3 py-2 text-xs text-[var(--text-primary)]">
            {(() => {
              const formatYm = formatMonthDE;
              if (deadlineRisks.length === 1) {
                const risk = deadlineRisks[0]!;
                return (
                  <span className="tabular-nums">
                    Mit dieser Verteilung ist der Termin von „{risk.potName}“ (
                    {formatYm(risk.targetMonth)}) voraussichtlich nicht
                    erreichbar – Fehlbetrag{" "}
                    {formatCentsDE(risk.shortfallAtDeadlineCents)}.
                  </span>
                );
              }
              const listed = deadlineRisks
                .slice(0, 3)
                .map((r) => `„${r.potName}“ (${formatYm(r.targetMonth)})`)
                .join(", ");
              const extra =
                deadlineRisks.length > 3
                  ? ` +${deadlineRisks.length - 3} weitere`
                  : "";
              const maxShortfall = Math.max(
                ...deadlineRisks.map((r) => r.shortfallAtDeadlineCents),
              );
              return (
                <span className="tabular-nums">
                  Mit dieser Verteilung sind die Termine von {listed}
                  {extra} voraussichtlich nicht erreichbar – höchster Fehlbetrag{" "}
                  {formatCentsDE(maxShortfall)}.
                </span>
              );
            })()}
          </div>
        ) : null}

        {validationErrorMessage || submitError ? (
          <div className="rounded-lg border border-[var(--rose)]/35 bg-[var(--rose)]/10 px-3 py-2 text-xs text-[var(--rose)]">
            {submitError ?? validationErrorMessage}
          </div>
        ) : null}

        <div className="flex items-center justify-end gap-2 border-t border-[var(--border)] pt-4">
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            Abbrechen
          </Button>
          <Button type="button" onClick={handleConfirm} disabled={!canSubmit}>
            {submitting ? "Verbuche..." : "Jetzt verbuchen"}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
