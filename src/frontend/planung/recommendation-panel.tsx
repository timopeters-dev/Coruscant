"use client";

import * as React from "react";
import { buildAllocationPrefillHref } from "@/frontend/allokation/allocation-prefill";
import { computeRecommendationFingerprint, recommendUse } from "@/domain/recommendation/recommendation";
import type { RecommendationState } from "@/domain/recommendation/types";
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
import type { RecommendationLabels } from "./recommendation-text";

interface RecommendationPanelProps {
  uiState: RecommendationUiState;
  dispatch: React.Dispatch<RecommendationUiAction>;
  recommendationState: RecommendationState;
  labels: RecommendationLabels;
  refLabels?: Record<string, string>;
  isDummy: boolean;
  showDebug: boolean;
}

export function RecommendationPanel({
  uiState,
  dispatch,
  recommendationState,
  labels,
  refLabels,
  isDummy,
  showDebug,
}: RecommendationPanelProps) {
  const deferred = React.useDeferredValue(uiState);
  const isStale = uiState !== deferred;

  const result = React.useMemo(
    () =>
      recommendUse(
        deferred.amountCents,
        recommendationState,
        deferred.assumptions,
      ),
    [deferred.amountCents, deferred.assumptions, recommendationState],
  );

  const prefillHref = React.useMemo(
    () => buildAllocationPrefillHref(result),
    [result],
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
          mode: "one_time",
          amountCents: uiState.amountCents,
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
      "details:has(#rec-one-time-etf-return)",
    );
    if (details) {
      details.open = true;
      details.scrollIntoView({ block: "nearest" });
    }
  };

  return (
    <PlanningPanelLayout
      title="Wohin mit X €?"
      intro="Prüft Notgroschen, nahe Topf-Termine, Sondertilgung (inkl. Zinsbindung) und ETF-Anlage."
      isStale={isStale}
      advancedModified={isRecommendationAssumptionsModified(uiState)}
      onReset={() => {
        dispatch({ type: "reset" });
        setExplainState({ status: "idle" });
      }}
      controls={
        <SliderField
          id="rec-one-time-amount"
          label="Verfügbarer Betrag (€)"
          value={uiState.amountCents}
          min={0}
          max={10_000_000}
          step={50_000}
          kind="euro"
          hint="Im Textfeld bis 10.000.000 € eingebbar"
          onChange={(v) => dispatch({ type: "setAmount", value: v })}
        />
      }
      advanced={
        <RecommendationAssumptionsFields
          idPrefix="rec-one-time"
          assumptions={uiState.assumptions}
          loans={recommendationState.loans}
          loanNames={labels.loanNames}
          dispatch={dispatch}
        />
      }
      result={
        <RecommendationResultContent
          result={result}
          labels={labels}
          refLabels={refLabels}
          isDummy={isDummy}
          showDebug={showDebug}
          prefillHref={prefillHref}
          onOpenAssumptions={openAssumptions}
          explainState={explainState}
          onExplain={handleExplain}
        />
      }
    />
  );
}
