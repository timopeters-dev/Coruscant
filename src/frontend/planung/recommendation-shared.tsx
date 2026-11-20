"use client";

import * as React from "react";
import Link from "next/link";
import { Sparkles } from "lucide-react";
import { AllocationBar, type AllocationBarSegment } from "@/frontend/charts/allocation-bar";
import { Button } from "@/frontend/ui/button";
import { formatEuroDE } from "@/domain/core/money";
import {
  computeRecommendationFingerprint,
  type RecommendationAssumptions,
  type RecommendationLoan,
  type RecommendationResult,
} from "@/domain/recommendation/recommendation";
import {
  ALLOWED_CHURCH_TAX_BPS,
  MAX_ETF_RETURN_BPS,
  MAX_SAVER_ALLOWANCE_CENTS,
  MIN_ETF_RETURN_BPS,
} from "@/domain/planning/scenarios";
import { SliderField } from "./euro-slider-field";
import type { RecommendationUiAction } from "./planning-state";
import {
  RecommendationExplanationBox,
  type ExplainUiState,
} from "./recommendation-explanation";
import {
  formatAssumptionsSummary,
  formatRecommendationHeadline,
  formatRecommendationNote,
  formatRecommendationReason,
  resolveItemLabel,
  type RecommendationLabels,
} from "./recommendation-text";
import { Select } from "@/frontend/ui/select";

interface RecommendationAssumptionsFieldsProps {
  assumptions: RecommendationAssumptions;
  loans: readonly RecommendationLoan[];
  loanNames: Record<string, string>;
  dispatch: React.Dispatch<RecommendationUiAction>;
  idPrefix: string;
}

export function RecommendationAssumptionsFields({
  assumptions,
  loans,
  loanNames,
  dispatch,
  idPrefix,
}: RecommendationAssumptionsFieldsProps) {
  return (
    <div className="flex flex-col gap-4">
      <SliderField
        id={`${idPrefix}-etf-return`}
        label="Erwartete ETF-Rendite p. a. (%)"
        value={assumptions.etfAnnualReturnBps}
        min={MIN_ETF_RETURN_BPS}
        max={MAX_ETF_RETURN_BPS}
        step={50}
        kind="percent"
        onChange={(v) =>
          dispatch({
            type: "setAssumption",
            field: "etfAnnualReturnBps",
            value: v,
          })
        }
      />

      <SliderField
        id={`${idPrefix}-safety-margin`}
        label="Sicherheitsaufschlag auf Break-even (%)"
        value={assumptions.safetyMarginBps}
        min={0}
        max={500}
        step={25}
        kind="percent"
        hint="ETF wird nur empfohlen, wenn Rendite ≥ Break-even + Aufschlag"
        onChange={(v) =>
          dispatch({
            type: "setAssumption",
            field: "safetyMarginBps",
            value: v,
          })
        }
      />

      <SliderField
        id={`${idPrefix}-emergency-months`}
        label="Notgroschen-Ziel (Monatsausgaben)"
        value={assumptions.emergencyFundMonths}
        min={1}
        max={12}
        step={1}
        kind="months"
        onChange={(v) =>
          dispatch({
            type: "setAssumption",
            field: "emergencyFundMonths",
            value: v,
          })
        }
      />

      <SliderField
        id={`${idPrefix}-short-horizon`}
        label="Termin gilt als nah bis (Monate)"
        value={assumptions.shortHorizonMonths}
        min={1}
        max={120}
        step={3}
        kind="months"
        onChange={(v) =>
          dispatch({
            type: "setAssumption",
            field: "shortHorizonMonths",
            value: v,
          })
        }
      />

      <SliderField
        id={`${idPrefix}-allowance`}
        label="Sparerpauschbetrag (€ / Jahr)"
        value={assumptions.saverAllowanceCents}
        min={0}
        max={MAX_SAVER_ALLOWANCE_CENTS}
        step={10_000}
        kind="euro"
        onChange={(v) =>
          dispatch({
            type: "setAssumption",
            field: "saverAllowanceCents",
            value: v,
          })
        }
      />

      <div className="flex flex-col gap-1.5">
        <label
          htmlFor={`${idPrefix}-church-tax`}
          className="text-xs font-medium text-[var(--text-secondary)]"
        >
          Kirchensteuer
        </label>
        <Select
          id={`${idPrefix}-church-tax`}
          value={assumptions.churchTaxBps}
          onChange={(e) =>
            dispatch({
              type: "setAssumption",
              field: "churchTaxBps",
              value: Number(e.target.value),
            })
          }
        >
          {ALLOWED_CHURCH_TAX_BPS.map((bps) => (
            <option key={bps} value={bps}>
              {bps === 0 ? "Keine (0 %)" : `${bps / 100} %`}
            </option>
          ))}
        </Select>
      </div>

      {loans.length > 0 ? (
        <div className="flex flex-col gap-3 border-t border-[var(--border)] pt-3">
          <p className="text-xs font-medium text-[var(--text-secondary)]">
            Diesjährig schon sondergetilgt
          </p>
          {loans.map((loan) => {
            const sliderMax =
              loan.specialRepaymentRule?.kind === "fixed"
                ? loan.specialRepaymentRule.capCents
                : 5_000_000;
            const currentUsed =
              assumptions.specialRepaymentUsedThisYearCentsByLoanId[loan.id] ??
              loan.specialRepaymentUsedThisYearCents ??
              0;
            return (
              <SliderField
                key={loan.id}
                id={`${idPrefix}-used-${loan.id}`}
                label={loanNames[loan.id] ?? loan.id}
                value={currentUsed}
                min={0}
                max={sliderMax}
                step={50_000}
                kind="euro"
                onChange={(v) =>
                  dispatch({
                    type: "setLoanUsedThisYear",
                    loanId: loan.id,
                    value: v,
                  })
                }
              />
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

interface RecommendationResultContentProps {
  result: RecommendationResult;
  labels: RecommendationLabels;
  refLabels?: Record<string, string>;
  isDummy: boolean;
  showDebug: boolean;
  prefillHref?: string | null;
  onOpenAssumptions?: () => void;
  explainState: ExplainUiState;
  onExplain: () => void;
}

export function RecommendationResultContent({
  result,
  labels,
  refLabels,
  isDummy,
  showDebug,
  prefillHref,
  onOpenAssumptions,
  explainState,
  onExplain,
}: RecommendationResultContentProps) {
  const headline = formatRecommendationHeadline(result, labels);
  const fingerprint = computeRecommendationFingerprint(result);

  const segments: AllocationBarSegment[] = result.items.map((item) => {
    const baseLabel = resolveItemLabel(item, labels);
    return {
      ref: item.ref,
      kind: item.kind,
      label:
        item.kind === "loan_rate_increase"
          ? `Rate erhöhen: ${baseLabel}`
          : baseLabel,
      amountCents: item.amountCents,
    };
  });

  const itemLabelsByRef: Record<string, string> = {};
  for (const seg of segments) {
    itemLabelsByRef[seg.ref] = seg.label;
  }

  const orderedNotes = [...result.notes].sort((a, b) => {
    const rank = (code: (typeof result.notes)[number]["code"]) => {
      if (code === "EMERGENCY_TARGET_UNKNOWN" || code === "NO_SURPLUS") {
        return 0;
      }
      if (code === "RATE_DECREASE_POSSIBLE") return 1;
      return 2;
    };
    return rank(a.code) - rank(b.code);
  });

  return (
    <div className="flex flex-col gap-5">
      {isDummy ? (
        <p className="rounded-lg border border-[var(--amber)]/40 bg-[var(--amber)]/10 px-3 py-2 text-xs text-[var(--text-primary)]">
          Hinweis: Basiert auf Beispiel-Haushaltsdaten (Modus A / Demo).
        </p>
      ) : null}

      <p className="text-base font-semibold leading-snug tracking-tight tabular-nums text-[var(--text-primary)]">
        {headline}
      </p>

      {result.items.length > 0 ? (
        <>
          <AllocationBar segments={segments} totalCents={result.amountCents} />

          <ul className="flex flex-col gap-3">
            {result.items.map((item) => {
              const baseLabel = resolveItemLabel(item, labels);
              const isRateIncrease = item.kind === "loan_rate_increase";
              const title =
                isRateIncrease &&
                item.currentMonthlyRateCents != null &&
                item.newMonthlyRateCents != null
                  ? `Rate erhöhen: ${baseLabel} von ${formatEuroDE(item.currentMonthlyRateCents)} auf ${formatEuroDE(item.newMonthlyRateCents)}/Monat`
                  : isRateIncrease
                    ? `Rate erhöhen: ${baseLabel}`
                    : baseLabel;
              return (
                <li
                  key={item.ref}
                  className="flex flex-col gap-1 rounded-xl border border-dashed border-[var(--border)] bg-[var(--surface-elevated)]/50 p-3.5"
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-sm font-semibold tabular-nums text-[var(--text-primary)]">
                      {title}
                    </span>
                    <span className="text-sm font-semibold tabular-nums text-[var(--text-primary)]">
                      {formatEuroDE(item.amountCents)}
                    </span>
                  </div>
                  <div className="flex flex-col gap-0.5 text-xs leading-relaxed text-[var(--text-secondary)]">
                    {item.reasons.map((r, idx) => (
                      <p key={idx}>{formatRecommendationReason(r)}</p>
                    ))}
                  </div>
                  {isRateIncrease && item.target.type === "loan" ? (
                    <p className="mt-1 text-xs text-[var(--text-secondary)]">
                      Beim Darlehensgeber beantragen, danach Rate und genutzte
                      Wechsel im Vertrag aktualisieren.{" "}
                      <Link
                        href={`/vertraege?vertrag=${encodeURIComponent(item.target.loanId)}`}
                        className="font-medium text-[var(--accent)] underline underline-offset-2 hover:opacity-80"
                      >
                        Zum Vertrag
                      </Link>
                    </p>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </>
      ) : null}

      {orderedNotes.length > 0 ? (
        <ul className="flex flex-col gap-1 text-xs text-[var(--text-secondary)]">
          {orderedNotes.map((n, idx) => (
            <li key={idx}>• {formatRecommendationNote(n, labels)}</li>
          ))}
        </ul>
      ) : null}

      <p className="text-xs leading-relaxed tabular-nums text-[var(--text-secondary)]">
        {formatAssumptionsSummary(result.assumptions)}{" "}
        {onOpenAssumptions ? (
          <button
            type="button"
            onClick={onOpenAssumptions}
            className="font-medium text-[var(--accent)] underline underline-offset-2 hover:opacity-80"
          >
            Ändern
          </button>
        ) : null}
      </p>

      {result.items.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            size="sm"
            onClick={onExplain}
            disabled={explainState.status === "loading"}
          >
            <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
            Erklär mir das
          </Button>
          {prefillHref ? (
            <Link
              href={prefillHref}
              className="inline-flex h-8 items-center justify-center gap-2 whitespace-nowrap rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 text-xs font-medium text-[var(--text-primary)] transition-colors hover:bg-[var(--surface-elevated)] outline-hidden focus-visible:ring-[3px] focus-visible:ring-[var(--focus)]"
            >
              In „Geld verteilen“ übernehmen
            </Link>
          ) : null}
        </div>
      ) : null}

      <RecommendationExplanationBox
        explainState={explainState}
        currentFingerprint={fingerprint}
        itemLabelsByRef={itemLabelsByRef}
        refLabels={refLabels}
        showDebug={showDebug}
        onRetry={onExplain}
      />

      <p className="border-t border-[var(--border)] pt-3 text-xs text-[var(--text-secondary)]">
        Orientierung, keine Anlageberatung. Berechnet aus deinem Ist-Stand und
        den Annahmen oben.
      </p>
    </div>
  );
}
