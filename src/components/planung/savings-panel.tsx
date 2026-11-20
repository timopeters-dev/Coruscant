"use client";

import * as React from "react";
import Link from "next/link";
import { StatusBadge } from "@/components/status-badge";
import { formatEuroDE } from "@/lib/domain/money";
import {
  computeRecommendationFingerprint,
  recommendMonthlySavings,
  type RecommendationState,
} from "@/lib/domain/recommendation";
import { SliderField } from "./euro-slider-field";
import { PlanningPanelLayout } from "./planning-panel-layout";
import {
  isRecommendationAssumptionsModified,
  type RecommendationUiAction,
  type RecommendationUiState,
} from "./planning-state";
import type { ExplainUiState } from "./recommendation-explanation";
import {
  RecommendationAssumptionsFields,
  RecommendationResultContent,
} from "./recommendation-shared";
import {
  formatRecommendationNote,
  type RecommendationLabels,
} from "./recommendation-text";

interface SavingsPanelProps {
  uiState: RecommendationUiState;
  dispatch: React.Dispatch<RecommendationUiAction>;
  recommendationState: RecommendationState;
  labels: RecommendationLabels;
  refLabels?: Record<string, string>;
  hasHouseholdData: boolean;
  isDummy: boolean;
  showDebug: boolean;
}

export function SavingsPanel({
  uiState,
  dispatch,
  recommendationState,
  labels,
  refLabels,
  hasHouseholdData,
  isDummy,
  showDebug,
}: SavingsPanelProps) {
  const deferred = React.useDeferredValue(uiState);
  const isStale = uiState !== deferred;

  const result = React.useMemo(
    () => recommendMonthlySavings(recommendationState, deferred.assumptions),
    [deferred.assumptions, recommendationState],
  );

  const [explainState, setExplainState] = React.useState<ExplainUiState>({
    status: "idle",
  });

  const handleExplain = async () => {
    const requestFingerprint = computeRecommendationFingerprint(result);
    setExplainState({ status: "loading", requestFingerprint });
    try {
      const response = await fetch("/api/coach/explain", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "monthly",
          assumptions: uiState.assumptions,
        }),
      });
      const data = (await response.json()) as {
        explanation?: ExplainUiState["explanation"];
        fingerprint?: string;
        model?: string;
        contextJson?: string;
        code?: string;
        error?: string;
      };
      if (!response.ok || !data.explanation) {
        setExplainState({
          status: "error",
          errorCode: data.code,
          errorMessage: data.error,
        });
        return;
      }
      setExplainState({
        status: "ok",
        explanation: data.explanation,
        fingerprint: data.fingerprint,
        requestFingerprint,
        model: data.model,
        contextJson: data.contextJson,
      });
    } catch {
      setExplainState({ status: "error", errorCode: "network_error" });
    }
  };

  const openAssumptions = () => {
    const details = document.querySelector<HTMLDetailsElement>(
      "details:has(#rec-monthly-etf-return)",
    );
    if (details) {
      details.open = true;
      details.scrollIntoView({ block: "nearest" });
    }
  };

  return (
    <PlanningPanelLayout
      title="Sparrate empfehlen"
      intro="Verteilt deinen monatlichen Haushaltsüberschuss auf Puffer, Notgroschen, Termin-Töpfe, Tilgung und ETF-Sparplan."
      isStale={isStale}
      advancedModified={isRecommendationAssumptionsModified(uiState)}
      onReset={() => {
        dispatch({ type: "reset" });
        setExplainState({ status: "idle" });
      }}
      controls={
        <div className="flex flex-col gap-5">
          <div className="flex items-center justify-between gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface-elevated)]/60 px-3.5 py-2.5">
            <div className="flex flex-col gap-0.5">
              <span className="text-xs text-[var(--text-secondary)]">
                Monatlicher Überschuss
              </span>
              <span className="text-base font-semibold tabular-nums">
                {formatEuroDE(recommendationState.monthlySurplusCents)}
              </span>
            </div>
            <StatusBadge
              variant={hasHouseholdData && !isDummy ? "calibrated" : "modeled"}
            />
          </div>

          <SliderField
            id="rec-monthly-buffer"
            label="Liquiditätspuffer auf Haushaltskonto (%)"
            value={uiState.assumptions.savingsBufferBps}
            min={0}
            max={5000}
            step={100}
            kind="percent"
            onChange={(v) =>
              dispatch({
                type: "setAssumption",
                field: "savingsBufferBps",
                value: v,
              })
            }
          />

          <SliderField
            id="rec-monthly-fill-months"
            label="Notgroschen auffüllen in (Monaten)"
            value={uiState.assumptions.emergencyFillMonths}
            min={1}
            max={60}
            step={1}
            kind="months"
            onChange={(v) =>
              dispatch({
                type: "setAssumption",
                field: "emergencyFillMonths",
                value: v,
              })
            }
          />
        </div>
      }
      advanced={
        <RecommendationAssumptionsFields
          idPrefix="rec-monthly"
          assumptions={uiState.assumptions}
          loans={recommendationState.loans}
          loanNames={labels.loanNames}
          dispatch={dispatch}
        />
      }
      result={
        recommendationState.monthlySurplusCents <= 0 ? (
          <div className="flex flex-col gap-4">
            <p className="text-sm text-[var(--text-secondary)]">
              Aktuell bleibt kein Überschuss – erst Ausgaben oder Einnahmen
              prüfen.
            </p>
            {result.notes.filter((n) => n.code !== "NO_SURPLUS").length > 0 ? (
              <ul className="flex flex-col gap-1 text-xs text-[var(--text-secondary)]">
                {result.notes
                  .filter((n) => n.code !== "NO_SURPLUS")
                  .map((n, idx) => (
                    <li key={idx}>• {formatRecommendationNote(n, labels)}</li>
                  ))}
              </ul>
            ) : null}
            <div>
              <Link
                href="/allokation"
                className="inline-flex h-8 items-center justify-center gap-2 whitespace-nowrap rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 text-xs font-medium text-[var(--text-primary)] transition-colors hover:bg-[var(--surface-elevated)] outline-hidden focus-visible:ring-[3px] focus-visible:ring-[var(--focus)]"
              >
                Zur Allokation
              </Link>
            </div>
            <p className="border-t border-[var(--border)] pt-3 text-xs text-[var(--text-secondary)]">
              Orientierung, keine Anlageberatung. Berechnet aus deinem
              Ist-Stand und den Annahmen oben.
            </p>
          </div>
        ) : (
          <RecommendationResultContent
            result={result}
            labels={labels}
            refLabels={refLabels}
            isDummy={isDummy}
            showDebug={showDebug}
            onOpenAssumptions={openAssumptions}
            explainState={explainState}
            onExplain={handleExplain}
          />
        )
      }
    />
  );
}
