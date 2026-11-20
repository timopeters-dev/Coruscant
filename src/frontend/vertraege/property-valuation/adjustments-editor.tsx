"use client";

import * as React from "react";
import type { PropertyApiRecord, PropertyRow } from "@/backend/db/queries/properties";
import type { PropertyValuationHistoryRow } from "@/backend/db/schema";
import { bpsToPercentInputString, formatCentsDE, parsePercentInputToBps } from "@/domain/core/money";
import { planAdjustmentRecompute } from "@/domain/properties/valuation/adjustment-recompute";
import {
  formatAdjustmentSummary,
  MAX_VALUATION_ADJUSTMENTS,
  normalizeAdjustmentLabel,
  normalizeValuationAdjustments,
  parseValuationAdjustments,
  sumAdjustmentBps,
  validateValuationAdjustments,
  type ValuationAdjustment,
} from "@/domain/properties/valuation/adjustments";
import {
  catalogItemsFor,
  getCatalogItem,
  reconcileWithCatalog,
  resolveCatalogToggle,
  summarizeAdjustmentDraft,
  VALUATION_CATALOG_GROUPS,
} from "@/domain/properties/valuation/catalog";
import { api } from "@/frontend/lib/api";
import { Button } from "@/frontend/ui/button";
import { StatusBadge } from "@/frontend/ui/status-badge";
import { VALUATION_ADJUSTMENT_ERROR_LABELS, VALUATION_VALUE_CHANGED_LABEL } from "../labels";
import { formatSignedBps } from "./view";

interface AdjustmentDraftRow {
  id: string;
  label: string;
  percentText: string;
  catalogKey?: string;
}

export function readPropertyAdjustments(
  raw: string | null | readonly ValuationAdjustment[],
): ValuationAdjustment[] {
  return typeof raw === "string" || raw === null
    ? parseValuationAdjustments(raw)
    : normalizeValuationAdjustments(raw);
}

function toDraftRows(list: readonly ValuationAdjustment[]): AdjustmentDraftRow[] {
  return reconcileWithCatalog(list).map((item, idx) => ({
    id: `adj-${idx}-${item.catalogKey ?? item.label}`,
    label: item.label,
    percentText: bpsToPercentInputString(item.bps, { allowNegative: true }),
    ...(item.catalogKey ? { catalogKey: item.catalogKey } : {}),
  }));
}

/**
 * „Eigene Korrektur“: Zu-/Abschläge auf die ImmoAnalyse-Schätzung (Katalog
 * oder frei), mit Live-Vorschau und Rückfrage, wenn sich der Objektwert ändert.
 */
export function ValuationAdjustmentsEditor({
  property,
  historyEntries,
  suggestionMedianCents,
  disabled,
  onSavingChange,
  onSaved,
}: {
  property: PropertyRow | PropertyApiRecord;
  historyEntries: PropertyValuationHistoryRow[];
  suggestionMedianCents: number | null;
  disabled: boolean;
  onSavingChange: (saving: boolean) => void;
  /** Nach dem Speichern (auch bei Konflikt): Objekt und Verlauf neu laden. */
  onSaved: () => void;
}) {
  const savedAdjustments = React.useMemo(
    () => readPropertyAdjustments(property.valuationAdjustments),
    [property.valuationAdjustments],
  );
  const savedTotalBps = sumAdjustmentBps(savedAdjustments);
  const [adjustmentsOpen, setAdjustmentsOpen] = React.useState(false);
  const [draftRows, setDraftRows] = React.useState<AdjustmentDraftRow[]>(() =>
    toDraftRows(savedAdjustments),
  );
  const [isSavingAdjustments, setIsSavingAdjustments] = React.useState(false);
  const [confirmingRecompute, setConfirmingRecompute] = React.useState<{
    fromCents: number;
    toCents: number;
  } | null>(null);
  const [adjustmentNotice, setAdjustmentNotice] = React.useState<string | null>(
    null,
  );
  const [adjustmentServerError, setAdjustmentServerError] = React.useState<
    string | null
  >(null);
  const [swapNotice, setSwapNotice] = React.useState<string | null>(null);
  const isBusy = disabled || isSavingAdjustments;

  /** Entwurf ändern; Hinweise und offene Rückfragen gelten dann nicht mehr. */
  function editDraft(update: (rows: AdjustmentDraftRow[]) => AdjustmentDraftRow[]) {
    setDraftRows(update);
    setSwapNotice(null);
    setConfirmingRecompute(null);
  }
  const editRow = (idx: number, patch: Partial<AdjustmentDraftRow>) =>
    editDraft((rows) => rows.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  function toggleOpen() {
    if (!adjustmentsOpen) {
      setDraftRows(toDraftRows(savedAdjustments));
      setConfirmingRecompute(null);
    }
    setAdjustmentsOpen(!adjustmentsOpen);
  }

  const draftValidation = React.useMemo(() => {
    const rowErrors: Record<number, { label?: string; bps?: string }> = {};
    const parsedItems: ValuationAdjustment[] = [];
    let hasParseError = false;
    let rawSumBps = 0;

    draftRows.forEach((row, idx) => {
      const bps = parsePercentInputToBps(row.percentText, {
        allowNegative: true,
      });
      if (bps === null) {
        hasParseError = true;
        rowErrors[idx] = {
          ...rowErrors[idx],
          bps: "Bitte gültigen Prozentwert (z. B. -10,00 oder +3,5) eingeben.",
        };
      } else {
        rawSumBps += bps;
      }
      parsedItems.push({
        label: normalizeAdjustmentLabel(row.label),
        bps: bps ?? 100, // placeholder if parse failed so label checks still run
        ...(row.catalogKey ? { catalogKey: row.catalogKey } : {}),
      });
    });

    const domainRes = validateValuationAdjustments(parsedItems);
    let totalError: string | null = null;
    let isTotalOutOfRange = false;
    if (!domainRes.ok) {
      for (const err of domainRes.errors) {
        const msg = VALUATION_ADJUSTMENT_ERROR_LABELS[err.code];
        if (err.index !== undefined) {
          if (err.code.startsWith("label_")) {
            rowErrors[err.index] = { ...rowErrors[err.index], label: msg };
          } else if (!rowErrors[err.index]?.bps) {
            rowErrors[err.index] = { ...rowErrors[err.index], bps: msg };
          }
        } else {
          if (err.code === "total_out_of_range") {
            isTotalOutOfRange = true;
            totalError =
              "Summe der Korrekturen darf höchstens ±50,00 % betragen, bitte einen Posten verringern";
          } else {
            totalError = msg;
          }
        }
      }
    }

    const valid = !hasParseError && domainRes.ok;
    const totalBps = valid ? sumAdjustmentBps(parsedItems) : null;
    return {
      valid,
      parsedItems,
      rowErrors,
      totalError,
      isTotalOutOfRange,
      rawSumBps,
      totalBps,
    };
  }, [draftRows]);

  const latestAppliedImmoEntry = React.useMemo(() => {
    let best: PropertyValuationHistoryRow | null = null;
    for (const e of historyEntries) {
      if (e.source !== "immoanalyse" || e.appliedAt === null) {
        continue;
      }
      if (
        !best ||
        e.appliedAt > best.appliedAt! ||
        (e.appliedAt === best.appliedAt && e.valuedAt > best.valuedAt)
      ) {
        best = e;
      }
    }
    return best;
  }, [historyEntries]);

  const previewBaseCents = React.useMemo(() => {
    if (latestAppliedImmoEntry) {
      const choice = latestAppliedImmoEntry.appliedChoice ?? "median";
      return choice === "lower"
        ? latestAppliedImmoEntry.lowerCents
        : choice === "upper"
          ? latestAppliedImmoEntry.upperCents
          : latestAppliedImmoEntry.medianCents;
    }
    return suggestionMedianCents;
  }, [latestAppliedImmoEntry, suggestionMedianCents]);

  const draftSummary = React.useMemo(
    () =>
      draftValidation.valid
        ? summarizeAdjustmentDraft(draftValidation.parsedItems, previewBaseCents)
        : {
            validation: { ok: false as const, errors: [] },
            totalBps: null,
            adjustedCents: null,
          },
    [draftValidation.valid, draftValidation.parsedItems, previewBaseCents],
  );
  const previewAdjustedCents = draftSummary.adjustedCents;

  async function executeSaveAdjustments(list: readonly ValuationAdjustment[]) {
    setIsSavingAdjustments(true);
    onSavingChange(true);
    setAdjustmentServerError(null);
    setAdjustmentNotice(null);
    const result = await api<{ recompute: { fromCents: number; toCents: number } | null }>(
      `/api/properties/${encodeURIComponent(property.id)}/valuation/adjustments`,
      { method: "PUT", json: { adjustments: list, expectedEstimatedValueCents: property.estimatedValueCents } },
    );
    setIsSavingAdjustments(false);
    onSavingChange(false);
    if (!result.ok && result.status === 409) {
      // Der Objektwert wurde zwischenzeitlich geändert: neu laden, nichts speichern.
      setConfirmingRecompute(null);
      setAdjustmentServerError(VALUATION_VALUE_CHANGED_LABEL);
      onSaved();
      return;
    }
    if (!result.ok) {
      setAdjustmentServerError(
        (result.status !== null && result.error) || "Korrekturposten konnten nicht gespeichert werden.",
      );
      return;
    }
    const { recompute } = result.data;
    setConfirmingRecompute(null);
    setAdjustmentNotice(
      recompute
        ? `Gespeichert · Objektwert aktualisiert (${formatCentsDE(recompute.fromCents)} → ${formatCentsDE(recompute.toCents)})`
        : "Korrekturposten gespeichert.",
    );
    onSaved();
  }

  function handleRequestSaveAdjustments() {
    if (!draftValidation.valid || draftValidation.totalBps === null) {
      return;
    }
    setAdjustmentServerError(null);
    setAdjustmentNotice(null);

    const plan = planAdjustmentRecompute({
      currentSource: property.estimatedValueSource,
      currentValueCents: property.estimatedValueCents,
      appliedEntry: latestAppliedImmoEntry,
      newTotalBps: draftValidation.totalBps,
    });

    if (plan.action === "recompute") {
      setConfirmingRecompute({
        fromCents: plan.fromCents,
        toCents: plan.toCents,
      });
      return;
    }

    void executeSaveAdjustments(draftValidation.parsedItems);
  }

  return (
      <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3 text-xs">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <button
            type="button"
            onClick={toggleOpen}
            className="flex items-center gap-2 text-left font-medium text-[var(--text-primary)] hover:text-[var(--accent)]"
          >
            <span>Eigene Korrektur</span>
            <span className="font-normal text-[var(--text-secondary)] tabular-nums">
              {savedAdjustments.length === 0
                ? "Keine"
                : `${formatAdjustmentSummary(savedAdjustments)} (${formatSignedBps(savedTotalBps)} gesamt)`}
            </span>
          </button>
          <button
            type="button"
            onClick={toggleOpen}
            className="text-[var(--text-secondary)] underline underline-offset-2 hover:text-[var(--text-primary)]"
          >
            {adjustmentsOpen ? "Schließen" : "Bearbeiten"}
          </button>
        </div>

        {adjustmentsOpen ? (
          <div className="mt-3 space-y-4 border-t border-[var(--border)] pt-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <p className="text-2xs leading-relaxed text-[var(--text-secondary)]">
                Der Dienst kennt nur Haustyp, PLZ/Ort, Flächen, Baujahr,
                Energieklasse und Miete. Lage im Viertel, Bauweise, Zustand,
                Ausstattung und Rechtliches kennt er nicht. Dafür sind diese
                Posten. Richtwerte zur Orientierung, kein Gutachten (Katalog v1).
              </p>
              <span className="shrink-0 tabular-nums text-2xs font-medium text-[var(--text-secondary)]">
                {draftRows.length} / {MAX_VALUATION_ADJUSTMENTS} Posten
              </span>
            </div>

            {/* Katalog-Gruppen */}
            <div className="space-y-2.5">
              {VALUATION_CATALOG_GROUPS.map((group) => {
                const items = catalogItemsFor(
                  property.propertyType ?? null,
                ).filter((item) => item.group === group.id);
                if (items.length === 0) return null;
                return (
                  <div key={group.id} className="space-y-1.5">
                    <p
                      className="text-2xs font-medium text-[var(--text-secondary)]"
                      title={group.hint}
                    >
                      {group.label}
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {items.map((item) => {
                        const isSelected = draftRows.some(
                          (r) => r.catalogKey === item.key,
                        );
                        const previewToggle = resolveCatalogToggle(
                          draftValidation.parsedItems,
                          item.key,
                        );
                        const isBlocked = previewToggle.action === "blocked";
                        return (
                          <button
                            key={item.key}
                            type="button"
                            aria-pressed={isSelected}
                            disabled={isBusy || isBlocked}
                            title={isBlocked ? "Maximal 8 Posten" : item.hint}
                            onClick={() => {
                              const res = resolveCatalogToggle(
                                draftValidation.parsedItems,
                                item.key,
                              );
                              if (res.action === "remove") {
                                setDraftRows((prev) =>
                                  prev.filter((r) => r.catalogKey !== res.key),
                                );
                                setSwapNotice(null);
                              } else if (res.action === "add") {
                                const replacedLabels = res.replaceKeys
                                  .map((k) => getCatalogItem(k)?.label)
                                  .filter((l): l is string => Boolean(l));
                                setDraftRows((prev) => [
                                  ...prev.filter(
                                    (r) =>
                                      !r.catalogKey ||
                                      !res.replaceKeys.includes(r.catalogKey),
                                  ),
                                  {
                                    id: `adj-cat-${res.item.key}-${Date.now()}`,
                                    label: res.item.label,
                                    percentText: bpsToPercentInputString(
                                      res.item.suggestedBps,
                                      { allowNegative: true },
                                    ),
                                    catalogKey: res.item.key,
                                  },
                                ]);
                                setSwapNotice(
                                  replacedLabels.length > 0
                                    ? `‚${replacedLabels.join(", ")}‘ ersetzt durch ‚${res.item.label}‘`
                                    : null,
                                );
                              }
                              setConfirmingRecompute(null);
                            }}
                            className={`rounded-md border px-2 py-1 text-2xs font-medium transition-colors outline-hidden focus-visible:ring-[3px] focus-visible:ring-[var(--focus)] disabled:cursor-not-allowed disabled:opacity-45 ${
                              isSelected
                                ? "border-[var(--control-edge)] bg-[var(--control)] text-[var(--control-foreground)]"
                                : "border-[var(--border)] bg-[var(--surface-elevated)]/60 text-[var(--text-primary)] hover:border-[var(--accent)]"
                            }`}
                          >
                            <span>{item.label}</span>{" "}
                            <span className="tabular-nums opacity-85">
                              ({formatSignedBps(item.suggestedBps)})
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>

            {swapNotice ? (
              <p className="text-2xs text-[var(--amber)]">{swapNotice}</p>
            ) : null}

            {/* Gewählte Posten */}
            <div className="space-y-2">
              {draftRows.map((row, idx) => {
                const errs = draftValidation.rowErrors[idx];
                const catalogItem = row.catalogKey
                  ? getCatalogItem(row.catalogKey)
                  : null;
                const typeMismatch =
                  Boolean(catalogItem?.appliesTo) &&
                  Boolean(property.propertyType) &&
                  !catalogItem!.appliesTo!.includes(property.propertyType!);

                return (
                  <div key={row.id} className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      {catalogItem ? (
                        <div className="flex min-w-[160px] flex-1 flex-wrap items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface-elevated)]/40 px-2.5 py-1.5 text-xs text-[var(--text-primary)]">
                          <span>{catalogItem.label}</span>
                          <span className="rounded bg-[var(--surface)] px-1.5 py-0.5 text-3xs text-[var(--text-secondary)]">
                            Katalog
                          </span>
                          {typeMismatch ? (
                            <span className="text-3xs text-[var(--amber)]">
                              passt nicht zum Objekttyp
                            </span>
                          ) : null}
                        </div>
                      ) : (
                        <input
                          type="text"
                          value={row.label}
                          onChange={(e) => editRow(idx, { label: e.target.value })}
                          placeholder="z. B. Fertighaus"
                          maxLength={60}
                          disabled={isBusy}
                          className="min-w-[160px] flex-1 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1.5 text-xs text-[var(--text-primary)] focus:border-[var(--accent)] focus:outline-none"
                        />
                      )}
                      <div className="flex items-center gap-1">
                        <input
                          type="text"
                          value={row.percentText}
                          onChange={(e) => editRow(idx, { percentText: e.target.value })}
                          placeholder="-10,00"
                          disabled={isBusy}
                          className="w-24 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1.5 text-right text-xs text-[var(--text-primary)] tabular-nums focus:border-[var(--accent)] focus:outline-none"
                        />
                        <span className="text-[var(--text-secondary)]">%</span>
                      </div>
                      {catalogItem ? (
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => editRow(idx, { percentText: bpsToPercentInputString(catalogItem.suggestedBps, { allowNegative: true }) })}
                          className="text-2xs text-[var(--accent)] underline underline-offset-2 hover:opacity-80"
                        >
                          Richtwert
                        </button>
                      ) : null}
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={isBusy}
                        onClick={() => editDraft((rows) => rows.filter((_, i) => i !== idx))}
                      >
                        Entfernen
                      </Button>
                    </div>
                    {errs?.label || errs?.bps ? (
                      <p className="text-2xs text-[var(--rose)]">
                        {[errs.label, errs.bps].filter(Boolean).join(" · ")}
                      </p>
                    ) : null}
                  </div>
                );
              })}
            </div>

            {draftValidation.totalError ? (
              <p className="text-2xs font-medium text-[var(--rose)]">
                {draftValidation.isTotalOutOfRange ? (
                  <span className="tabular-nums">
                    {formatSignedBps(draftValidation.rawSumBps)} ·{" "}
                  </span>
                ) : null}
                {draftValidation.totalError}
              </p>
            ) : null}

            {/* Live-Vorschau */}
            {draftValidation.totalBps !== null ? (
              <div className="space-y-1 rounded-lg border border-dashed border-[var(--border)] bg-[var(--surface-elevated)]/40 px-2.5 py-2 tabular-nums">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[var(--text-secondary)]">
                    {previewBaseCents !== null
                      ? `Rohwert ImmoAnalyse ${formatCentsDE(previewBaseCents)} (unverändert)`
                      : "Ohne ImmoAnalyse-Rohwert"}
                  </span>
                  <StatusBadge variant="modeled" />
                </div>
                <p className="text-[var(--text-primary)]">
                  Korrektur{" "}
                  <strong className="font-semibold">
                    {formatSignedBps(draftValidation.totalBps)}
                  </strong>
                  {previewAdjustedCents !== null ? (
                    <>
                      {" → "}
                      <strong className="font-semibold">
                        {formatCentsDE(previewAdjustedCents)}
                      </strong>
                    </>
                  ) : null}
                </p>
              </div>
            ) : null}

            {property.estimatedValueSource === "manual" ? (
              <p className="text-2xs text-[var(--text-secondary)]">
                Wirkt bei der nächsten Übernahme, der manuelle Wert bleibt.
              </p>
            ) : null}

            {adjustmentServerError ? (
              <p className="text-2xs text-[var(--rose)]">
                {adjustmentServerError}
              </p>
            ) : null}
            {adjustmentNotice ? (
              <p className="text-2xs text-[var(--emerald)]">
                {adjustmentNotice}
              </p>
            ) : null}

            {confirmingRecompute ? (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--amber)]/40 bg-[var(--amber)]/10 px-3 py-2">
                <span className="text-[var(--text-primary)] tabular-nums">
                  Objektwert von{" "}
                  {formatCentsDE(confirmingRecompute.fromCents)} auf{" "}
                  {formatCentsDE(confirmingRecompute.toCents)} setzen?
                </span>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={isBusy}
                    onClick={() => setConfirmingRecompute(null)}
                  >
                    Abbrechen
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    disabled={isBusy}
                    onClick={() =>
                      void executeSaveAdjustments(draftValidation.parsedItems)
                    }
                  >
                    {isSavingAdjustments ? "Speichert…" : "Bestätigen"}
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={
                    isBusy || draftRows.length >= MAX_VALUATION_ADJUSTMENTS
                  }
                  onClick={() => {
                    setDraftRows((prev) => [
                      ...prev,
                      {
                        id: `adj-new-${Date.now()}-${prev.length}`,
                        label: "",
                        percentText: "",
                      },
                    ]);
                    setConfirmingRecompute(null);
                  }}
                >
                  + Freier Posten
                </Button>
                <Button
                  type="button"
                  size="sm"
                  disabled={isBusy || !draftValidation.valid}
                  onClick={handleRequestSaveAdjustments}
                >
                  {isSavingAdjustments ? "Speichert…" : "Korrekturen speichern"}
                </Button>
              </div>
            )}
          </div>
        ) : null}
      </div>
  );
}
