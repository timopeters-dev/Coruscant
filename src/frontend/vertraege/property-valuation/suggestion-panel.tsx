"use client";

import { formatCentsDE } from "@/domain/core/money";
import {
  getSelectedValuationCents,
  type ValuationAdoptionAction,
  type ValuationAdoptionState,
  type ValuationChoice,
} from "@/domain/properties/valuation/adoption";
import { computeValuationDeviationBps, isDeviationAboveThreshold } from "@/domain/properties/valuation/valuation";
import { formatIsoDateDE } from "@/frontend/planung/format";
import { Button } from "@/frontend/ui/button";
import { StatusBadge } from "@/frontend/ui/status-badge";
import { VALUATION_CONFIDENCE_LABELS } from "../labels";
import { formatDeviationPercent, formatSignedBps, type PendingSuggestionView } from "./view";

/** Offener KI-Vorschlag: Spanne wählen und nach Rückfrage übernehmen. */
export function ValuationSuggestionPanel({
  suggestion,
  adoptionState,
  dispatch,
  currentValueCents,
  onConfirm,
}: {
  suggestion: PendingSuggestionView;
  adoptionState: Exclude<ValuationAdoptionState, { phase: "idle" }>;
  dispatch: (action: ValuationAdoptionAction) => void;
  currentValueCents: number;
  onConfirm: () => void;
}) {
  const bounds = {
    lowerCents: suggestion.adjustedLowerCents,
    medianCents: suggestion.adjustedMedianCents,
    upperCents: suggestion.adjustedUpperCents,
  };
  const selectedCents = getSelectedValuationCents(bounds, adoptionState.choice);
  const deviationBps = computeValuationDeviationBps(suggestion.adjustedMedianCents, currentValueCents);
  const showDeviationWarning = isDeviationAboveThreshold(deviationBps);
  const handleConfirmAdopt = onConfirm;

  return (
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
                {formatCentsDE(suggestion.adjustedLowerCents)}
              </span>
              {" – "}
              <strong className="font-semibold text-[var(--text-primary)]">
                {formatCentsDE(suggestion.adjustedMedianCents)}
              </strong>
              {" – "}
              <span className="text-[var(--text-secondary)]">
                {formatCentsDE(suggestion.adjustedUpperCents)}
              </span>
              {deviationBps !== null
                ? ` (${formatDeviationPercent(deviationBps)})`
                : ""}
            </p>
            {suggestion.adjustmentBps !== 0 ? (
              <p className="mt-0.5 text-2xs text-[var(--text-secondary)] tabular-nums">
                Basis ImmoAnalyse: {formatCentsDE(suggestion.lowerCents)} –{" "}
                {formatCentsDE(suggestion.medianCents)} –{" "}
                {formatCentsDE(suggestion.upperCents)} (
                {formatSignedBps(suggestion.adjustmentBps)})
              </p>
            ) : null}
            <p className="mt-0.5 text-xs text-[var(--text-secondary)] tabular-nums">
              Aktueller Objektwert: {formatCentsDE(currentValueCents)}
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

          {suggestion.factors.length > 0 ? (
            <div className="space-y-1 text-xs text-[var(--text-secondary)]">
              <p className="font-medium text-[var(--text-primary)]">
                Vom Dienst berücksichtigt:
              </p>
              <div className="flex flex-wrap gap-1.5">
                {suggestion.factors.map((f, idx) => (
                  <span
                    key={idx}
                    className="rounded-md border border-[var(--border)] bg-[var(--surface-elevated)] px-2 py-0.5 text-2xs"
                  >
                    {f.label}{" "}
                    {f.effect === "up"
                      ? "↑"
                      : f.effect === "down"
                        ? "↓"
                        : "•"}
                  </span>
                ))}
              </div>
            </div>
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
                    getSelectedValuationCents(
                      {
                        lowerCents: suggestion.adjustedLowerCents,
                        medianCents: suggestion.adjustedMedianCents,
                        upperCents: suggestion.adjustedUpperCents,
                      },
                      choiceKey,
                    ),
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
                Objektwert von {formatCentsDE(currentValueCents)} auf{" "}
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
  );
}
