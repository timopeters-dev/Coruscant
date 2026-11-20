"use client";

import * as React from "react";
import type { PropertyApiRecord, PropertyRow } from "@/backend/db/queries/properties";
import type { PropertyValuation, ValuationWarning } from "@/domain/properties/valuation/valuation";
import { formatCentsDE } from "@/domain/core/money";
import {
  applyValuationAdjustment, sumAdjustmentBps,
} from "@/domain/properties/valuation/adjustments";
import {
  AUTO_VALUATION_INTERVALS,
  estimateMonthlyCalls,
  getNextDue,
  type AutoValuationInterval,
} from "@/domain/properties/valuation/auto-schedule";
import { buildAdoptionRequest } from "@/domain/properties/valuation/adoption";
import { api } from "@/frontend/lib/api";
import { formatDateDE } from "@/domain/core/date-format";
import { Button } from "@/frontend/ui/button";
import { Select } from "@/frontend/ui/select";
import { StatusBadge } from "@/frontend/ui/status-badge";
import { AUTO_VALUATION_INTERVAL_LABELS, AUTO_VALUATION_OUTCOME_LABELS } from "../labels";
import { PropertyValuationHistoryChart } from "../property-valuation-history-chart";
import { readPropertyAdjustments, ValuationAdjustmentsEditor } from "./adjustments-editor";
import { ValuationSuggestionPanel } from "./suggestion-panel";
import { useValuationData } from "./use-valuation-data";
import {
  formatSignedBps, mapApiErrorToState, toBerlinDateKeyClient, type CardErrorState,
  type PendingSuggestionView,
} from "./view";

/**
 * Wertschätzung einer Immobilie über ImmoAnalyse.Pro: Status, eigene
 * Korrekturen, automatische Aktualisierung, offener Vorschlag und Verlauf.
 * Werte ändern sich nur nach ausdrücklicher Übernahme.
 */
export function PropertyValuationCard({
  property,
  showDebug = false,
  onMutated,
}: {
  property: PropertyRow | PropertyApiRecord;
  showDebug?: boolean;
  onMutated: () => void;
}) {
  const data = useValuationData(property.id, property.updatedAt);
  const {
    previewJson, contextUnavailable, historyEntries, statusData, suggestion, adoptionState,
    dispatch,
  } = data;
  const [previewOpen, setPreviewOpen] = React.useState(false);
  const [previewLoading, setPreviewLoading] = React.useState(false);
  const [isEstimating, setIsEstimating] = React.useState(false);
  const [isSavingInterval, setIsSavingInterval] = React.useState(false);
  const [isSavingAdjustments, setIsSavingAdjustments] = React.useState(false);
  const [errorState, setErrorState] = React.useState<CardErrorState | null>(null);
  const [adoptedNotice, setAdoptedNotice] = React.useState(false);

  const savedTotalBps = sumAdjustmentBps(readPropertyAdjustments(property.valuationAdjustments));
  const valuationUrl = `/api/properties/${encodeURIComponent(property.id)}/valuation`;
  const isBusy = isEstimating || isSavingInterval || isSavingAdjustments || adoptionState.phase === "submitting";

  const afterChange = async () => {
    onMutated();
    await data.reload();
  };

  async function handleDeleteHistoryEntry(historyId: string) {
    const result = await api(`${valuationUrl}/history/${encodeURIComponent(historyId)}`, { method: "DELETE" });
    if (!result.ok && result.status !== 404) throw new Error(result.error ?? "Eintrag konnte nicht gelöscht werden.");
    await data.reload();
  }

  async function handleTogglePreview() {
    const nextOpen = !previewOpen;
    setPreviewOpen(nextOpen);
    if (nextOpen && !previewJson && !contextUnavailable) {
      setPreviewLoading(true);
      await data.reload();
      setPreviewLoading(false);
    }
  }

  async function handleIntervalChange(autoValuationInterval: AutoValuationInterval) {
    setIsSavingInterval(true);
    setErrorState(null);
    const result = await api(`/api/properties/${encodeURIComponent(property.id)}`, { method: "PATCH", json: { autoValuationInterval } });
    setIsSavingInterval(false);
    if (!result.ok) {
      setErrorState({ tone: "rose", message: "Intervall konnte nicht gespeichert werden." });
      return;
    }
    await afterChange();
  }

  async function handleEstimate() {
    setIsEstimating(true);
    setErrorState(null);
    setAdoptedNotice(false);
    const result = await api<{
      valuation: PropertyValuation;
      warnings?: ValuationWarning[];
      historyId: string;
      requestJson?: string;
      cached?: boolean;
    }>(valuationUrl, { method: "POST", json: {} });
    setIsEstimating(false);

    if (!result.ok) {
      const code = result.body?.code as string | undefined;
      if (result.status === null) setErrorState({ tone: "rose", message: "ImmoAnalyse.Pro ist derzeit nicht erreichbar." });
      else if (code === "valuation_context_unavailable") data.setContextUnavailable(result.error ?? data.contextMissingMessage);
      else setErrorState(mapApiErrorToState(code, result.body?.reason as string | undefined, result.error ?? undefined));
      return;
    }

    const { valuation, historyId, requestJson, cached, warnings } = result.data;
    if (requestJson) data.setPreviewJson(requestJson);
    const next: PendingSuggestionView = {
      historyId,
      lowerCents: valuation.lowerCents,
      medianCents: valuation.medianCents,
      upperCents: valuation.upperCents,
      adjustmentBps: valuation.adjustmentBps,
      adjustedLowerCents: valuation.adjustedLowerCents,
      adjustedMedianCents: valuation.adjustedMedianCents,
      adjustedUpperCents: valuation.adjustedUpperCents,
      asOfDate: valuation.asOfDate,
      valuedAtDate: toBerlinDateKeyClient(new Date().toISOString()),
      confidence: valuation.confidence,
      confidenceScore: valuation.confidenceScore,
      pricePerSqmMedianCents: valuation.pricePerSqmMedianCents,
      rationale: valuation.rationale,
      limitations: valuation.limitations,
      factors: valuation.factors,
      cached: Boolean(cached),
      warnings: warnings ?? [],
    };
    data.setSuggestion(next);
    dispatch({ type: "suggest", historyId });
    await data.reload();
  }

  async function handleConfirmAdopt() {
    const request = buildAdoptionRequest(adoptionState, { type: "confirm" });
    if (!request) return;
    dispatch({ type: "confirm" });
    setErrorState(null);
    const result = await api(`${valuationUrl}/adopt`, { method: "POST", json: request });
    if (!result.ok) {
      dispatch({ type: "failed" });
      setErrorState({ tone: "rose", message: "Übernahme fehlgeschlagen." });
      return;
    }
    dispatch({ type: "done" });
    data.setSuggestion(null);
    setAdoptedNotice(true);
    await afterChange();
  }

  const latestHistory = [...historyEntries].reverse().find((entry) => entry.trigger !== "adjustment") ?? null;
  const schedulerJob = statusData?.scheduler.jobs.find((job) => job.jobId === "property_valuation") ?? null;
  const quotaSnapshot = statusData?.quota.snapshot ?? null;
  const quotaEval = statusData?.quota.evaluation ?? null;
  const planned = statusData?.plannedConsumption ?? null;
  const nextDue = getNextDue(
    property.autoValuationInterval,
    property.lastAutoValuationAt ? toBerlinDateKeyClient(property.lastAutoValuationAt) : null,
  );

  let nextRunText = "aus";
  if (statusData && !statusData.configured) nextRunText = "nicht konfiguriert (IMMOANALYSE_API_KEY fehlt)";
  else if (schedulerJob && !schedulerJob.enabled) nextRunText = "pausiert: Dev ohne ENABLE_VALUATION_SCHEDULER";
  else if (quotaEval && !quotaEval.allowed) {
    nextRunText = quotaEval.resetAt
      ? `pausiert: Reserve geschützt bis ${formatDateDE(toBerlinDateKeyClient(quotaEval.resetAt))}`
      : "pausiert: Reserve geschützt";
  } else if (nextDue !== null) {
    nextRunText = "dueNow" in nextDue ? "bei nächstem Lauf" : `ab ${formatDateDE(nextDue.dueOn)}, 04:30`;
  }

  return (
    <div className="space-y-3 rounded-xl border border-dashed border-[var(--border)] bg-[var(--surface-elevated)]/30 p-4 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="space-y-0.5">
          <div className="flex items-center gap-2">
            <p className="section-label text-[var(--text-secondary)]">
              Wertschätzung · ImmoAnalyse.Pro
            </p>
            <StatusBadge variant="modeled" />
          </div>
          <p className="text-2xs text-[var(--text-secondary)]">
            Wertindikation, kein Gutachten.
          </p>
          {adoptedNotice ? (
            <p className="text-xs font-medium text-[var(--emerald)]">
              Übernommen
            </p>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          {showDebug ? (
            <button
              type="button"
              onClick={handleTogglePreview}
              className="text-xs text-[var(--text-secondary)] underline underline-offset-2 hover:text-[var(--text-primary)]"
            >
              Was der Dienst sieht
            </button>
          ) : null}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleEstimate}
            disabled={isBusy || Boolean(contextUnavailable)}
          >
            {isEstimating ? "Schätzt…" : "Jetzt schätzen"}
          </Button>
        </div>
      </div>

      {/* Statuszeilen */}
      <div className="grid gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3 text-xs text-[var(--text-secondary)] tabular-nums">
        <p>
          <span className="font-medium text-[var(--text-primary)]">
            Aktueller Wert:
          </span>{" "}
          {property.estimatedValueSource === "manual"
            ? "manuell"
            : property.estimatedValueAsOf
              ? `aus ImmoAnalyse, Stand ${formatDateDE(property.estimatedValueAsOf)}${savedTotalBps !== 0 ? `, inkl. ${formatSignedBps(savedTotalBps)} eigene Korrektur` : ""}`
              : `aus ImmoAnalyse${savedTotalBps !== 0 ? `, inkl. ${formatSignedBps(savedTotalBps)} eigene Korrektur` : ""}`}
        </p>
        <p>
          <span className="font-medium text-[var(--text-primary)]">
            Letzte Schätzung:
          </span>{" "}
          {latestHistory
            ? `${formatDateDE(toBerlinDateKeyClient(latestHistory.valuedAt))} · ${formatCentsDE(applyValuationAdjustment(latestHistory.medianCents, latestHistory.adjustmentBps))}`
            : "noch keine"}
          {property.lastAutoValuationOutcome
            ? ` (${AUTO_VALUATION_OUTCOME_LABELS[property.lastAutoValuationOutcome]})`
            : ""}
        </p>
        <p>
          <span className="font-medium text-[var(--text-primary)]">
            Nächste Schätzung:
          </span>{" "}
          {nextRunText}
        </p>
        <p>
          <span className="font-medium text-[var(--text-primary)]">
            Kontingent:
          </span>{" "}
          {quotaSnapshot
            ? `${quotaSnapshot.remaining} von ${quotaSnapshot.limit} frei${
                quotaSnapshot.resetAt
                  ? ` · Reset ${formatDateDE(quotaSnapshot.resetAt.slice(0, 10))}`
                  : ""
              }`
            : "unbekannt (noch keine Abfrage)"}
        </p>
      </div>

      {quotaSnapshot && quotaSnapshot.remaining === 0 ? (
        <p className="rounded-lg border border-[var(--amber)]/40 bg-[var(--amber)]/10 px-3 py-2 text-xs text-[var(--amber)]">
          Hinweis: Das API-Kontingent ist aktuell erschöpft (0 frei).
        </p>
      ) : null}

      {/* Eigene Korrektur (lokal) */}
      <ValuationAdjustmentsEditor
        property={property}
        historyEntries={historyEntries}
        suggestionMedianCents={suggestion?.medianCents ?? null}
        disabled={isEstimating || isSavingInterval || adoptionState.phase === "submitting"}
        onSavingChange={setIsSavingAdjustments}
        onSaved={() => void afterChange()}
      />

      {/* Intervall & Verbrauchsrechnung */}
      <div className="space-y-1.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <label
            htmlFor={`auto-val-interval-${property.id}`}
            className="text-xs font-medium text-[var(--text-secondary)]"
          >
            Automatische Aktualisierung
          </label>
          <Select
            id={`auto-val-interval-${property.id}`}
            value={property.autoValuationInterval}
            onChange={(e) =>
              void handleIntervalChange(
                e.target.value as AutoValuationInterval,
              )
            }
            disabled={isBusy}
            className="w-44"
          >
            {AUTO_VALUATION_INTERVALS.map((interval) => (
              <option key={interval} value={interval}>
                {AUTO_VALUATION_INTERVAL_LABELS[interval]}
              </option>
            ))}
          </Select>
        </div>
        {planned ? (
          <p className="text-2xs text-[var(--text-secondary)] tabular-nums">
            ≈ {estimateMonthlyCalls(property.autoValuationInterval)}{" "}
            Abfragen/Monat für dieses Objekt · alle Objekte zusammen bis zu{" "}
            {planned.peakMonthly} von {planned.autoBudget} (3 Reserve)
          </p>
        ) : null}
        {planned?.overBudget ? (
          <p className="rounded-lg border border-[var(--amber)]/40 bg-[var(--amber)]/10 px-3 py-2 text-xs text-[var(--amber)]">
            Mehr als das Auto-Budget, einzelne Läufe verschieben sich.
          </p>
        ) : null}
      </div>

      {contextUnavailable ? (
        <p className="text-xs text-[var(--text-secondary)]">
          {contextUnavailable}
        </p>
      ) : null}

      {showDebug && previewOpen ? (
        <div className="space-y-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
          <p className="text-xs text-[var(--text-secondary)]">
            Straße, Hausnummer, Name, Ausstattungstext, Sanierungen und
            Dokumente werden nicht gesendet.
          </p>
          {previewLoading ? (
            <p className="text-xs text-[var(--text-secondary)]">Lädt…</p>
          ) : previewJson ? (
            <pre className="max-h-56 overflow-auto rounded-md bg-[var(--surface-elevated)] p-2.5 text-2xs leading-relaxed text-[var(--text-primary)] tabular-nums">
              {previewJson}
            </pre>
          ) : (
            <p className="text-xs text-[var(--text-secondary)]">
              Keine Vorschau verfügbar.
            </p>
          )}
        </div>
      ) : null}

      {errorState ? (
        <p
          className={`rounded-lg border px-3 py-2 text-xs ${
            errorState.tone === "amber"
              ? "border-[var(--amber)]/40 bg-[var(--amber)]/10 text-[var(--amber)]"
              : "border-[var(--rose)]/30 bg-[var(--rose)]/10 text-[var(--rose)]"
          }`}
        >
          {errorState.message}
        </p>
      ) : null}

      {suggestion && adoptionState.phase !== "idle" ? (
        <ValuationSuggestionPanel
          suggestion={suggestion}
          adoptionState={adoptionState}
          dispatch={dispatch}
          currentValueCents={property.estimatedValueCents}
          onConfirm={handleConfirmAdopt}
        />
      ) : null}

      <PropertyValuationHistoryChart
        entries={historyEntries}
        onDeleteEntry={handleDeleteHistoryEntry}
      />
    </div>
  );
}

