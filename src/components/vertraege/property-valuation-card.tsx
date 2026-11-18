"use client";

import * as React from "react";
import { formatIsoDateDE } from "@/components/planung/format";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import type { PropertyRow } from "@/db/queries/contracts";
import type { PropertyValuationHistoryRow } from "@/db/schema";
import {
  AUTO_VALUATION_INTERVALS,
  estimateMonthlyCalls,
  getNextDue,
  type AutoValuationInterval,
  type PlannedConsumptionSummary,
  type QuotaEvaluation,
  type QuotaSnapshot,
} from "@/lib/domain/auto-valuation-schedule";
import { formatBpsDE, formatCentsDE } from "@/lib/domain/money";
import {
  computeValuationDeviationBps,
  isDeviationAboveThreshold,
  type PropertyValuation,
  type ValuationRejectReason,
  type ValuationWarning,
} from "@/lib/domain/property-valuation";
import {
  buildAdoptionRequest,
  getSelectedValuationCents,
  INITIAL_VALUATION_ADOPTION_STATE,
  valuationAdoptionReducer,
  type ValuationChoice,
} from "@/lib/domain/valuation-adoption";
import type { ValuatorErrorCode } from "@/lib/integrations/property-valuator";
import {
  AUTO_VALUATION_INTERVAL_LABELS,
  AUTO_VALUATION_OUTCOME_LABELS,
  VALUATION_CONFIDENCE_LABELS,
  VALUATION_ERROR_CODE_LABELS,
  VALUATION_REJECT_REASON_LABELS,
} from "./labels";
import { PropertyValuationHistoryChart } from "./property-valuation-history-chart";

interface PropertyValuationCardProps {
  property: PropertyRow;
  onMutated: () => void;
}

interface CardErrorState {
  tone: "rose" | "amber";
  message: string;
}

interface ValuationStatusResponse {
  configured: boolean;
  scheduler: {
    running: boolean;
    jobs: Array<{
      jobId: string;
      enabled: boolean;
      lastStatus: string | null;
      lastRunAt: string | null;
      message: string;
      nextSlotAt: string;
    }>;
  };
  quota: {
    snapshot: QuotaSnapshot | null;
    evaluation: QuotaEvaluation;
  };
  plannedConsumption: PlannedConsumptionSummary;
}

interface PendingSuggestionView {
  historyId: string;
  lowerCents: number;
  medianCents: number;
  upperCents: number;
  asOfDate: string;
  valuedAtDate: string;
  confidence: "low" | "medium" | "high" | null;
  confidenceScore: number | null;
  pricePerSqmMedianCents: number | null;
  rationale: string | null;
  limitations: string[];
  factors: Array<{ label: string; effect: "up" | "down" | "neutral" }>;
  cached: boolean;
  warnings: ValuationWarning[];
}

function mapApiErrorToState(
  code: string | undefined,
  reason: string | undefined,
  fallbackError: string | undefined,
): CardErrorState {
  if (code === "valuation_rejected" && reason) {
    const label =
      reason in VALUATION_REJECT_REASON_LABELS
        ? VALUATION_REJECT_REASON_LABELS[reason as ValuationRejectReason]
        : "Wertschätzung konnte nicht plausibilisiert werden.";
    return { tone: "amber", message: label };
  }
  if (code && code in VALUATION_ERROR_CODE_LABELS) {
    const errCode = code as ValuatorErrorCode;
    const tone =
      errCode === "not_valuable" || errCode === "quota_exceeded"
        ? "amber"
        : "rose";
    return {
      tone,
      message: VALUATION_ERROR_CODE_LABELS[errCode],
    };
  }
  return {
    tone: "rose",
    message: fallbackError ?? "Wertschätzung fehlgeschlagen.",
  };
}

const berlinDateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Berlin",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function toBerlinDateKeyClient(isoTimestamp: string): string {
  return berlinDateFormatter.format(new Date(isoTimestamp));
}

function formatDeviationPercent(deviationBps: number): string {
  const sign = deviationBps >= 0 ? "+" : "−";
  return `${sign}${formatBpsDE(Math.abs(deviationBps))}`;
}

function mapHistoryToSuggestion(
  row: PropertyValuationHistoryRow,
): PendingSuggestionView {
  return {
    historyId: row.id,
    lowerCents: row.lowerCents,
    medianCents: row.medianCents,
    upperCents: row.upperCents,
    asOfDate: row.dataAsOf ?? toBerlinDateKeyClient(row.valuedAt),
    valuedAtDate: toBerlinDateKeyClient(row.valuedAt),
    confidence: row.confidence,
    confidenceScore: row.confidenceScore,
    pricePerSqmMedianCents: null,
    rationale: null,
    limitations: [],
    factors: [],
    cached: false,
    warnings: [],
  };
}

export function PropertyValuationCard({
  property,
  onMutated,
}: PropertyValuationCardProps) {
  const [previewOpen, setPreviewOpen] = React.useState(false);
  const [previewJson, setPreviewJson] = React.useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = React.useState(false);
  const [contextUnavailable, setContextUnavailable] = React.useState<
    string | null
  >(null);

  const [isEstimating, setIsEstimating] = React.useState(false);
  const [isSavingInterval, setIsSavingInterval] = React.useState(false);
  const [suggestion, setSuggestion] =
    React.useState<PendingSuggestionView | null>(null);
  const suggestionRef = React.useRef<PendingSuggestionView | null>(null);
  React.useEffect(() => {
    suggestionRef.current = suggestion;
  }, [suggestion]);
  const [historyEntries, setHistoryEntries] = React.useState<
    PropertyValuationHistoryRow[]
  >([]);
  const [statusData, setStatusData] =
    React.useState<ValuationStatusResponse | null>(null);
  const [errorState, setErrorState] = React.useState<CardErrorState | null>(
    null,
  );
  const [adoptedNotice, setAdoptedNotice] = React.useState(false);

  const [adoptionState, dispatch] = React.useReducer(
    valuationAdoptionReducer,
    INITIAL_VALUATION_ADOPTION_STATE,
  );

  const loadAll = React.useCallback(async () => {
    try {
      const [previewRes, historyRes, statusRes] = await Promise.all([
        fetch(`/api/properties/${encodeURIComponent(property.id)}/valuation`),
        fetch(
          `/api/properties/${encodeURIComponent(property.id)}/valuation/history`,
        ),
        fetch("/api/valuation/status"),
      ]);

      const previewBody = (await previewRes.json()) as {
        requestJson?: string;
        usable?: boolean;
        error?: string;
      };
      if (previewRes.ok && previewBody.usable && previewBody.requestJson) {
        setPreviewJson(previewBody.requestJson);
        setContextUnavailable(null);
      } else {
        setPreviewJson(null);
        if (previewRes.status === 422) {
          setContextUnavailable(
            previewBody.error ??
              "PLZ, Wohnfläche und Objekttyp pflegen, um eine Schätzung zu erhalten.",
          );
        }
      }

      if (historyRes.ok) {
        const histBody = (await historyRes.json()) as {
          entries: PropertyValuationHistoryRow[];
          pendingSuggestion: PropertyValuationHistoryRow | null;
        };
        setHistoryEntries(histBody.entries);
        if (histBody.pendingSuggestion) {
          if (
            suggestionRef.current?.historyId === histBody.pendingSuggestion.id
          ) {
            // Keep rich details (rationale, limitations, cached) from just-run POST
          } else {
            const mapped = mapHistoryToSuggestion(histBody.pendingSuggestion);
            setSuggestion(mapped);
            dispatch({ type: "suggest", historyId: mapped.historyId });
          }
        } else {
          setSuggestion(null);
          dispatch({ type: "reset" });
        }
      }

      if (statusRes.ok) {
        const sBody = (await statusRes.json()) as ValuationStatusResponse;
        setStatusData(sBody);
      }
    } catch {
      // Ignore transient load errors on mount
    }
  }, [property.id]);

  React.useEffect(() => {
    let cancelled = false;
    async function syncOnMount() {
      try {
        const [previewRes, historyRes, statusRes] = await Promise.all([
          fetch(`/api/properties/${encodeURIComponent(property.id)}/valuation`),
          fetch(
            `/api/properties/${encodeURIComponent(property.id)}/valuation/history`,
          ),
          fetch("/api/valuation/status"),
        ]);
        if (cancelled) return;

        const previewBody = (await previewRes.json()) as {
          requestJson?: string;
          usable?: boolean;
          error?: string;
        };
        if (cancelled) return;
        if (previewRes.ok && previewBody.usable && previewBody.requestJson) {
          setPreviewJson(previewBody.requestJson);
          setContextUnavailable(null);
        } else {
          setPreviewJson(null);
          if (previewRes.status === 422) {
            setContextUnavailable(
              previewBody.error ??
                "PLZ, Wohnfläche und Objekttyp pflegen, um eine Schätzung zu erhalten.",
            );
          }
        }

        if (historyRes.ok) {
          const histBody = (await historyRes.json()) as {
            entries: PropertyValuationHistoryRow[];
            pendingSuggestion: PropertyValuationHistoryRow | null;
          };
          if (cancelled) return;
          setHistoryEntries(histBody.entries);
          if (histBody.pendingSuggestion) {
            if (
              suggestionRef.current?.historyId !== histBody.pendingSuggestion.id
            ) {
              const mapped = mapHistoryToSuggestion(histBody.pendingSuggestion);
              setSuggestion(mapped);
              dispatch({ type: "suggest", historyId: mapped.historyId });
            }
          } else {
            setSuggestion(null);
            dispatch({ type: "reset" });
          }
        }

        if (statusRes.ok) {
          const sBody = (await statusRes.json()) as ValuationStatusResponse;
          if (!cancelled) {
            setStatusData(sBody);
          }
        }
      } catch {
        // Ignore transient load errors on mount
      }
    }
    void syncOnMount();
    return () => {
      cancelled = true;
    };
  }, [property.id, property.updatedAt]);

  async function handleTogglePreview() {
    const nextOpen = !previewOpen;
    setPreviewOpen(nextOpen);
    if (nextOpen && !previewJson && !contextUnavailable) {
      setPreviewLoading(true);
      await loadAll();
      setPreviewLoading(false);
    }
  }

  async function handleIntervalChange(nextInterval: AutoValuationInterval) {
    setIsSavingInterval(true);
    setErrorState(null);
    try {
      const res = await fetch(
        `/api/properties/${encodeURIComponent(property.id)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ autoValuationInterval: nextInterval }),
        },
      );
      if (!res.ok) {
        setErrorState({
          tone: "rose",
          message: "Intervall konnte nicht gespeichert werden.",
        });
        return;
      }
      onMutated();
      await loadAll();
    } catch {
      setErrorState({
        tone: "rose",
        message: "Intervall konnte nicht gespeichert werden.",
      });
    } finally {
      setIsSavingInterval(false);
    }
  }

  async function handleEstimate() {
    setIsEstimating(true);
    setErrorState(null);
    setAdoptedNotice(false);
    try {
      const res = await fetch(
        `/api/properties/${encodeURIComponent(property.id)}/valuation`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        },
      );
      const data = (await res.json()) as {
        valuation?: PropertyValuation;
        warnings?: ValuationWarning[];
        historyId?: string;
        requestJson?: string;
        cached?: boolean;
        code?: string;
        reason?: string;
        error?: string;
      };

      if (!res.ok || !data.valuation || !data.historyId) {
        if (data.code === "valuation_context_unavailable") {
          setContextUnavailable(
            data.error ??
              "PLZ, Wohnfläche und Objekttyp pflegen, um eine Schätzung zu erhalten.",
          );
        } else {
          setErrorState(
            mapApiErrorToState(data.code, data.reason, data.error),
          );
        }
        return;
      }

      if (data.requestJson) {
        setPreviewJson(data.requestJson);
      }
      const nextSuggestion: PendingSuggestionView = {
        historyId: data.historyId,
        lowerCents: data.valuation.lowerCents,
        medianCents: data.valuation.medianCents,
        upperCents: data.valuation.upperCents,
        asOfDate: data.valuation.asOfDate,
        valuedAtDate: toBerlinDateKeyClient(new Date().toISOString()),
        confidence: data.valuation.confidence,
        confidenceScore: data.valuation.confidenceScore,
        pricePerSqmMedianCents: data.valuation.pricePerSqmMedianCents,
        rationale: data.valuation.rationale,
        limitations: data.valuation.limitations,
        factors: data.valuation.factors,
        cached: Boolean(data.cached),
        warnings: data.warnings ?? [],
      };
      suggestionRef.current = nextSuggestion;
      setSuggestion(nextSuggestion);
      dispatch({ type: "suggest", historyId: data.historyId });
      await loadAll();
    } catch {
      setErrorState({
        tone: "rose",
        message: "ImmoAnalyse.Pro ist derzeit nicht erreichbar.",
      });
    } finally {
      setIsEstimating(false);
    }
  }

  async function handleConfirmAdopt() {
    const reqBody = buildAdoptionRequest(adoptionState, { type: "confirm" });
    if (!reqBody) return;

    dispatch({ type: "confirm" });
    setErrorState(null);

    try {
      const res = await fetch(
        `/api/properties/${encodeURIComponent(property.id)}/valuation/adopt`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(reqBody),
        },
      );

      if (!res.ok) {
        dispatch({ type: "failed" });
        setErrorState({
          tone: "rose",
          message: "Übernahme fehlgeschlagen.",
        });
        return;
      }

      dispatch({ type: "done" });
      suggestionRef.current = null;
      setSuggestion(null);
      setAdoptedNotice(true);
      onMutated();
      await loadAll();
    } catch {
      dispatch({ type: "failed" });
      setErrorState({
        tone: "rose",
        message: "Übernahme fehlgeschlagen.",
      });
    }
  }

  const isBusy =
    isEstimating || isSavingInterval || adoptionState.phase === "submitting";
  const selectedCents =
    suggestion &&
    (adoptionState.phase === "suggested" ||
      adoptionState.phase === "confirming" ||
      adoptionState.phase === "submitting")
      ? getSelectedValuationCents(suggestion, adoptionState.choice)
      : null;

  const latestHistory =
    historyEntries.length > 0
      ? historyEntries[historyEntries.length - 1]
      : null;

  const schedulerJob = statusData?.scheduler.jobs[0] ?? null;
  const quotaSnapshot = statusData?.quota.snapshot ?? null;
  const quotaEval = statusData?.quota.evaluation ?? null;
  const planned = statusData?.plannedConsumption ?? null;

  const nextDue = getNextDue(
    property.autoValuationInterval,
    property.lastAutoValuationAt
      ? toBerlinDateKeyClient(property.lastAutoValuationAt)
      : null,
  );

  let nextRunText = "aus";
  if (statusData && !statusData.configured) {
    nextRunText = "nicht konfiguriert (IMMOANALYSE_API_KEY fehlt)";
  } else if (schedulerJob && !schedulerJob.enabled) {
    nextRunText = "pausiert: Dev ohne ENABLE_VALUATION_SCHEDULER";
  } else if (quotaEval && !quotaEval.allowed) {
    nextRunText = quotaEval.resetAt
      ? `pausiert: Reserve geschützt bis ${formatIsoDateDE(toBerlinDateKeyClient(quotaEval.resetAt))}`
      : "pausiert: Reserve geschützt";
  } else if (nextDue !== null) {
    nextRunText =
      "dueNow" in nextDue
        ? "bei nächstem Lauf"
        : `ab ${formatIsoDateDE(nextDue.dueOn)}, 04:30`;
  }

  const deviationBps = suggestion
    ? computeValuationDeviationBps(
        suggestion.medianCents,
        property.estimatedValueCents,
      )
    : null;
  const showDeviationWarning = isDeviationAboveThreshold(deviationBps);

  return (
    <div className="space-y-3 rounded-xl border border-dashed border-[var(--border)] bg-[var(--surface-elevated)]/30 p-4 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="space-y-0.5">
          <div className="flex items-center gap-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-[var(--text-secondary)]">
              Wertschätzung · ImmoAnalyse.Pro
            </p>
            <StatusBadge variant="modeled" />
          </div>
          <p className="text-[11px] text-[var(--text-secondary)]">
            Wertindikation, kein Gutachten.
          </p>
          {adoptedNotice ? (
            <p className="text-xs font-medium text-[var(--emerald)]">
              Übernommen
            </p>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleTogglePreview}
            className="text-xs text-[var(--text-secondary)] underline underline-offset-2 hover:text-[var(--text-primary)]"
          >
            Was der Dienst sieht
          </button>
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
              ? `aus ImmoAnalyse, Stand ${formatIsoDateDE(property.estimatedValueAsOf)}`
              : "aus ImmoAnalyse"}
        </p>
        <p>
          <span className="font-medium text-[var(--text-primary)]">
            Letzte Schätzung:
          </span>{" "}
          {latestHistory
            ? `${formatIsoDateDE(toBerlinDateKeyClient(latestHistory.valuedAt))} · ${formatCentsDE(latestHistory.medianCents)}`
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
                  ? ` · Reset ${formatIsoDateDE(quotaSnapshot.resetAt.slice(0, 10))}`
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
          <p className="text-[11px] text-[var(--text-secondary)] tabular-nums">
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

      {previewOpen ? (
        <div className="space-y-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
          <p className="text-xs text-[var(--text-secondary)]">
            Straße, Hausnummer, Name, Ausstattungstext, Sanierungen und
            Dokumente werden nicht gesendet.
          </p>
          {previewLoading ? (
            <p className="text-xs text-[var(--text-secondary)]">Lädt…</p>
          ) : previewJson ? (
            <pre className="max-h-56 overflow-auto rounded-md bg-[var(--surface-elevated)] p-2.5 text-[11px] leading-relaxed text-[var(--text-primary)] tabular-nums">
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

      {/* Offener Vorschlag */}
      {suggestion && adoptionState.phase !== "idle" ? (
        <div className="space-y-3 rounded-xl border border-[var(--amber)]/50 bg-[var(--surface)] p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <StatusBadge variant="ai_suggestion" />
            <span className="text-xs text-[var(--text-secondary)] tabular-nums">
              Stand: {formatIsoDateDE(suggestion.asOfDate)}
              {suggestion.confidence
                ? ` · Konfidenz: ${VALUATION_CONFIDENCE_LABELS[suggestion.confidence]}${
                    suggestion.confidenceScore !== null
                      ? ` (${suggestion.confidenceScore}/100)`
                      : ""
                  }`
                : ""}
            </span>
          </div>

          <div>
            <p className="tabular-nums text-sm text-[var(--text-primary)]">
              Auto-Schätzung vom {formatIsoDateDE(suggestion.valuedAtDate)}:{" "}
              <span className="text-[var(--text-secondary)]">
                {formatCentsDE(suggestion.lowerCents)}
              </span>
              {" – "}
              <strong className="font-semibold text-[var(--text-primary)]">
                {formatCentsDE(suggestion.medianCents)}
              </strong>
              {" – "}
              <span className="text-[var(--text-secondary)]">
                {formatCentsDE(suggestion.upperCents)}
              </span>
              {deviationBps !== null
                ? ` (${formatDeviationPercent(deviationBps)})`
                : ""}
            </p>
            <p className="mt-0.5 text-xs text-[var(--text-secondary)] tabular-nums">
              Aktueller Objektwert: {formatCentsDE(property.estimatedValueCents)}
              {suggestion.pricePerSqmMedianCents !== null
                ? ` · Median: ${formatCentsDE(suggestion.pricePerSqmMedianCents)} / m²`
                : ""}
              {suggestion.cached
                ? " · aus Zwischenspeicher, nicht gezählt"
                : ""}
            </p>
          </div>

          {showDeviationWarning && deviationBps !== null ? (
            <p className="rounded-lg border border-[var(--amber)]/40 bg-[var(--amber)]/10 px-3 py-2 text-xs text-[var(--amber)] tabular-nums">
              Hinweis: Abweichung vom aktuellen Objektwert beträgt{" "}
              {formatDeviationPercent(deviationBps)} (&gt; ±40 %). Bitte
              manuell prüfen.
            </p>
          ) : null}

          {suggestion.rationale ? (
            <p className="text-xs text-[var(--text-secondary)]">
              {suggestion.rationale}
            </p>
          ) : null}

          {suggestion.limitations.length > 0 ? (
            <ul className="list-disc space-y-0.5 pl-4 text-xs text-[var(--text-secondary)]">
              {suggestion.limitations.map((item, idx) => (
                <li key={idx}>{item}</li>
              ))}
            </ul>
          ) : null}

          <div className="flex flex-wrap items-center gap-2 pt-1">
            {(
              [
                ["lower", "Untere"],
                ["median", "Median"],
                ["upper", "Obere"],
              ] as Array<[ValuationChoice, string]>
            ).map(([choiceKey, label]) => {
              const active = adoptionState.choice === choiceKey;
              return (
                <button
                  key={choiceKey}
                  type="button"
                  disabled={adoptionState.phase === "submitting"}
                  onClick={() => dispatch({ type: "choose", choice: choiceKey })}
                  className={`rounded-lg border px-2.5 py-1 text-xs font-medium tabular-nums transition-colors ${
                    active
                      ? "border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--accent)]"
                      : "border-[var(--border)] bg-[var(--surface)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                  }`}
                >
                  {label} (
                  {formatCentsDE(
                    getSelectedValuationCents(suggestion, choiceKey),
                  )}
                  )
                </button>
              );
            })}

            {adoptionState.phase === "suggested" ? (
              <Button
                type="button"
                size="sm"
                onClick={() => dispatch({ type: "requestAdopt" })}
                className="ml-auto"
              >
                Übernehmen
              </Button>
            ) : null}
          </div>

          {adoptionState.phase === "confirming" ||
          adoptionState.phase === "submitting" ? (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--amber)]/40 bg-[var(--amber)]/10 px-3 py-2 text-xs">
              <span className="text-[var(--text-primary)] tabular-nums">
                Objektwert von {formatCentsDE(property.estimatedValueCents)} auf{" "}
                {selectedCents !== null ? formatCentsDE(selectedCents) : "–"}{" "}
                setzen, Stand {formatIsoDateDE(suggestion.asOfDate)}?
              </span>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={adoptionState.phase === "submitting"}
                  onClick={() => dispatch({ type: "cancel" })}
                >
                  Abbrechen
                </Button>
                <Button
                  type="button"
                  size="sm"
                  disabled={adoptionState.phase === "submitting"}
                  onClick={handleConfirmAdopt}
                >
                  {adoptionState.phase === "submitting"
                    ? "Speichert…"
                    : "Bestätigen"}
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      <PropertyValuationHistoryChart entries={historyEntries} />
    </div>
  );
}
