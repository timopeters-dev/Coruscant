"use client";

import * as React from "react";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import type { PropertyRow } from "@/db/queries/contracts";
import { getTodayIsoDate } from "@/lib/domain/date";
import { formatBpsDE, formatCentsDE } from "@/lib/domain/money";
import type {
  PropertyValuation,
  ValuationRejectReason,
  ValuationWarning,
} from "@/lib/domain/property-valuation";
import {
  buildAdoptionPatch,
  getSelectedValuationCents,
  INITIAL_VALUATION_ADOPTION_STATE,
  valuationAdoptionReducer,
  type ValuationChoice,
} from "@/lib/domain/valuation-adoption";
import {
  VALUATION_CONFIDENCE_LABELS,
  VALUATION_REJECT_REASON_LABELS,
} from "./labels";

interface PropertyValuationCardProps {
  property: PropertyRow;
  onMutated: () => void;
}

interface CardErrorState {
  tone: "rose" | "amber";
  message: string;
}

function mapApiErrorToState(
  code: string | undefined,
  reason: string | undefined,
  fallbackError: string | undefined,
): CardErrorState {
  if (code === "not_configured") {
    return {
      tone: "amber",
      message: "KI nicht konfiguriert (GEMINI_API_KEY fehlt).",
    };
  }
  if (code === "timeout" || code === "network_error" || code === "http_error") {
    return {
      tone: "rose",
      message: fallbackError
        ? `KI nicht erreichbar. Später erneut versuchen. (${fallbackError})`
        : "KI nicht erreichbar. Später erneut versuchen.",
    };
  }
  if (code === "invalid_payload") {
    return {
      tone: "rose",
      message: "KI-Antwort war unbrauchbar.",
    };
  }
  if (code === "valuation_rejected" && reason) {
    const label =
      reason in VALUATION_REJECT_REASON_LABELS
        ? VALUATION_REJECT_REASON_LABELS[reason as ValuationRejectReason]
        : "KI-Wertschätzung konnte nicht plausibilisiert werden.";
    return {
      tone: "amber",
      message: label,
    };
  }
  return {
    tone: "rose",
    message: fallbackError ?? "Wertschätzung fehlgeschlagen.",
  };
}

function formatDeviationPercent(deviationBps: number): string {
  const sign = deviationBps >= 0 ? "+" : "−";
  return `${sign}${formatBpsDE(Math.abs(deviationBps))}`;
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
  const [valuation, setValuation] = React.useState<PropertyValuation | null>(
    null,
  );
  const [valuationContextJson, setValuationContextJson] = React.useState<
    string | null
  >(null);
  const valuationContextJsonRef = React.useRef<string | null>(null);
  React.useEffect(() => {
    valuationContextJsonRef.current = valuationContextJson;
  }, [valuationContextJson]);
  const [warnings, setWarnings] = React.useState<ValuationWarning[]>([]);
  const [queriesOpen, setQueriesOpen] = React.useState(false);
  const [errorState, setErrorState] = React.useState<CardErrorState | null>(
    null,
  );
  const [adoptedNotice, setAdoptedNotice] = React.useState(false);

  const [adoptionState, dispatch] = React.useReducer(
    valuationAdoptionReducer,
    INITIAL_VALUATION_ADOPTION_STATE,
  );

  const loadPreview = React.useCallback(async (): Promise<boolean> => {
    setPreviewLoading(true);
    try {
      const res = await fetch(
        `/api/properties/${encodeURIComponent(property.id)}/valuation`,
      );
      const data = (await res.json()) as {
        contextJson?: string;
        usable?: boolean;
        code?: string;
        error?: string;
      };
      if (res.ok && data.usable && data.contextJson) {
        setPreviewJson(data.contextJson);
        setContextUnavailable(null);
        return true;
      }
      setPreviewJson(null);
      if (res.status === 422) {
        setContextUnavailable(
          "PLZ und Wohnfläche im Objekt pflegen, um eine Schätzung zu erhalten.",
        );
      }
      return false;
    } catch {
      return false;
    } finally {
      setPreviewLoading(false);
    }
  }, [property.id]);

  React.useEffect(() => {
    let cancelled = false;
    async function checkAvailability() {
      try {
        const res = await fetch(
          `/api/properties/${encodeURIComponent(property.id)}/valuation`,
        );
        const data = (await res.json()) as {
          contextJson?: string;
          usable?: boolean;
        };
        if (cancelled) return;
        if (res.ok && data.usable && data.contextJson) {
          setPreviewJson(data.contextJson);
          setContextUnavailable(null);
          if (
            valuationContextJsonRef.current !== null &&
            data.contextJson !== valuationContextJsonRef.current
          ) {
            setValuation(null);
            setWarnings([]);
            setValuationContextJson(null);
            dispatch({ type: "reset" });
          }
        } else {
          setPreviewJson(null);
          if (valuationContextJsonRef.current !== null) {
            setValuation(null);
            setWarnings([]);
            setValuationContextJson(null);
            dispatch({ type: "reset" });
          }
          if (res.status === 422) {
            setContextUnavailable(
              "PLZ und Wohnfläche im Objekt pflegen, um eine Schätzung zu erhalten.",
            );
          }
        }
      } catch {
        // Ignore transient preview check errors on mount
      }
    }
    void checkAvailability();
    return () => {
      cancelled = true;
    };
  }, [property.id, property.updatedAt]);

  async function handleTogglePreview() {
    const nextOpen = !previewOpen;
    setPreviewOpen(nextOpen);
    if (nextOpen && !previewJson && !contextUnavailable) {
      await loadPreview();
    }
  }

  async function handleEstimate() {
    setIsEstimating(true);
    setErrorState(null);
    setAdoptedNotice(false);
    setQueriesOpen(false);
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
        contextJson?: string;
        code?: string;
        reason?: string;
        error?: string;
      };

      if (!res.ok || !data.valuation) {
        if (data.code === "valuation_context_unavailable") {
          setContextUnavailable(
            "PLZ und Wohnfläche im Objekt pflegen, um eine Schätzung zu erhalten.",
          );
        } else {
          setErrorState(
            mapApiErrorToState(data.code, data.reason, data.error),
          );
        }
        return;
      }

      if (data.contextJson) {
        setPreviewJson(data.contextJson);
        setValuationContextJson(data.contextJson);
      } else {
        setValuationContextJson(previewJson);
      }
      setValuation(data.valuation);
      setWarnings(data.warnings ?? []);
      dispatch({ type: "suggest" });
    } catch {
      setErrorState({
        tone: "rose",
        message: "KI nicht erreichbar. Später erneut versuchen.",
      });
    } finally {
      setIsEstimating(false);
    }
  }

  async function handleConfirmAdopt() {
    if (!valuation) return;
    const today = getTodayIsoDate();
    const patch = buildAdoptionPatch(
      adoptionState,
      { type: "confirm" },
      valuation,
      today,
    );
    if (!patch) return;

    dispatch({ type: "confirm" });
    setErrorState(null);

    try {
      const res = await fetch(
        `/api/properties/${encodeURIComponent(property.id)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch),
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
      setValuation(null);
      setValuationContextJson(null);
      setWarnings([]);
      setAdoptedNotice(true);
      onMutated();
    } catch {
      dispatch({ type: "failed" });
      setErrorState({
        tone: "rose",
        message: "Übernahme fehlgeschlagen.",
      });
    }
  }

  const today = getTodayIsoDate();
  const isBusy = isEstimating || adoptionState.phase === "submitting";
  const selectedCents =
    valuation &&
    (adoptionState.phase === "suggested" ||
      adoptionState.phase === "confirming" ||
      adoptionState.phase === "submitting")
      ? getSelectedValuationCents(valuation, adoptionState.choice)
      : null;

  return (
    <div className="space-y-3 rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)]/30 p-4 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="space-y-0.5">
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--text-secondary)]">
            KI-Wertschätzung (optional)
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
            Was die KI sieht
          </button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleEstimate}
            disabled={isBusy || Boolean(contextUnavailable)}
          >
            {isEstimating ? "Schätzt…" : "Wertspanne schätzen"}
          </Button>
        </div>
      </div>

      {contextUnavailable ? (
        <p className="text-xs text-[var(--text-secondary)]">
          {contextUnavailable}
        </p>
      ) : null}

      {previewOpen ? (
        <div className="space-y-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
          <p className="text-xs text-[var(--text-secondary)]">
            Straße, Hausnummer, Name und Dokumente werden nicht gesendet. Die
            Suche läuft über Google.
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

      {valuation && adoptionState.phase !== "idle" ? (
        <div className="space-y-3 rounded-xl border border-[var(--amber)]/50 bg-[var(--surface)] p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <StatusBadge variant="ai_suggestion" />
            <span className="text-xs text-[var(--text-secondary)] tabular-nums">
              Marktdaten-Stand: {valuation.asOfDate} · Konfidenz:{" "}
              {VALUATION_CONFIDENCE_LABELS[valuation.confidence]}
            </span>
          </div>

          <div>
            <p className="tabular-nums text-base text-[var(--text-primary)]">
              <span className="text-[var(--text-secondary)]">
                {formatCentsDE(valuation.lowerCents)}
              </span>
              {" – "}
              <strong className="font-semibold text-[var(--text-primary)]">
                {formatCentsDE(valuation.medianCents)}
              </strong>
              {" – "}
              <span className="text-[var(--text-secondary)]">
                {formatCentsDE(valuation.upperCents)}
              </span>
            </p>
            <p className="mt-0.5 text-xs text-[var(--text-secondary)] tabular-nums">
              Median: {formatCentsDE(valuation.pricePerSqmMedianCents)} / m²
            </p>
          </div>

          {warnings.map((w, idx) => (
            <p
              key={idx}
              className="rounded-lg border border-[var(--amber)]/40 bg-[var(--amber)]/10 px-3 py-2 text-xs text-[var(--amber)] tabular-nums"
            >
              Weicht um {formatDeviationPercent(w.deviationBps)} vom aktuellen
              Objektwert ab. Bitte Quellen prüfen.
            </p>
          ))}

          <p className="text-xs leading-relaxed text-[var(--text-primary)]">
            {valuation.rationale}
          </p>

          {valuation.factors.length > 0 ? (
            <ul className="space-y-1 text-xs text-[var(--text-secondary)]">
              {valuation.factors.map((factor, idx) => (
                <li key={idx} className="flex items-center gap-1.5">
                  <span aria-hidden="true" className="font-semibold">
                    {factor.effect === "up"
                      ? "↑"
                      : factor.effect === "down"
                        ? "↓"
                        : "–"}
                  </span>
                  <span>{factor.label}</span>
                </li>
              ))}
            </ul>
          ) : null}

          <div className="space-y-1 border-t border-[var(--border)]/60 pt-2">
            <p className="text-[11px] font-medium text-[var(--text-secondary)]">
              Quellen
            </p>
            <ul className="space-y-0.5 text-xs">
              {valuation.sources.map((source) => (
                <li key={source.uri}>
                  <a
                    href={source.uri}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[var(--accent)] underline underline-offset-2 hover:opacity-80"
                  >
                    {source.title}
                  </a>
                </li>
              ))}
            </ul>

            {valuation.searchQueries.length > 0 ? (
              <div className="pt-1">
                <button
                  type="button"
                  onClick={() => setQueriesOpen((prev) => !prev)}
                  className="text-[11px] text-[var(--text-secondary)] underline underline-offset-2 hover:text-[var(--text-primary)]"
                >
                  {queriesOpen
                    ? "Suchanfragen der KI ausblenden"
                    : "Suchanfragen der KI"}
                </button>
                {queriesOpen ? (
                  <ul className="mt-1 list-disc pl-4 text-[11px] text-[var(--text-secondary)]">
                    {valuation.searchQueries.map((query) => (
                      <li key={query}>{query}</li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ) : null}
          </div>

          <p className="text-[11px] text-[var(--text-secondary)]">
            Orientierung, kein Gutachten. Für Finanzierung, Verkauf oder Steuer
            ist ein Verkehrswertgutachten nötig.
          </p>

          <div className="space-y-2 border-t border-[var(--border)]/60 pt-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div
                role="group"
                aria-label="Schätzwert auswählen"
                className="inline-flex rounded-lg border border-[var(--border)] bg-[var(--surface-elevated)] p-0.5 text-xs"
              >
                {(
                  [
                    ["lower", "Untere"],
                    ["median", "Median"],
                    ["upper", "Obere"],
                  ] as const satisfies readonly [ValuationChoice, string][]
                ).map(([choiceKey, label]) => {
                  const active = adoptionState.choice === choiceKey;
                  return (
                    <button
                      key={choiceKey}
                      type="button"
                      disabled={adoptionState.phase === "submitting"}
                      onClick={() =>
                        dispatch({ type: "choose", choice: choiceKey })
                      }
                      className={`rounded-md px-2.5 py-1 transition-colors ${
                        active
                          ? "bg-[var(--surface)] font-medium text-[var(--text-primary)] shadow-xs"
                          : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                      }`}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>

              {adoptionState.phase === "suggested" ? (
                <Button
                  type="button"
                  size="sm"
                  onClick={() => dispatch({ type: "requestAdopt" })}
                >
                  Wert übernehmen
                </Button>
              ) : null}
            </div>

            {adoptionState.phase === "confirming" ||
            adoptionState.phase === "submitting" ? (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--amber)]/40 bg-[var(--amber)]/10 px-3 py-2 text-xs">
                <span className="tabular-nums text-[var(--text-primary)]">
                  Objektwert von{" "}
                  <strong>{formatCentsDE(property.estimatedValueCents)}</strong>{" "}
                  auf{" "}
                  <strong>
                    {selectedCents != null ? formatCentsDE(selectedCents) : "–"}
                  </strong>{" "}
                  setzen, Stand {today}?
                </span>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    size="sm"
                    onClick={handleConfirmAdopt}
                    disabled={adoptionState.phase === "submitting"}
                  >
                    {adoptionState.phase === "submitting"
                      ? "Speichert…"
                      : "Bestätigen"}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => dispatch({ type: "cancel" })}
                    disabled={adoptionState.phase === "submitting"}
                  >
                    Abbrechen
                  </Button>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
