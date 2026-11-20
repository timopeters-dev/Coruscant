"use client";

import * as React from "react";
import { RefreshCw } from "lucide-react";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { RecommendationExplanation } from "@/lib/validation/recommendation";

export interface ExplainUiState {
  status: "idle" | "loading" | "ok" | "error";
  explanation?: RecommendationExplanation;
  fingerprint?: string;
  requestFingerprint?: string;
  model?: string;
  contextJson?: string;
  errorCode?: string;
  errorMessage?: string;
}

interface RecommendationExplanationBoxProps {
  explainState: ExplainUiState;
  currentFingerprint: string;
  itemLabelsByRef: Record<string, string>;
  refLabels?: Record<string, string>;
  showDebug: boolean;
  onRetry: () => void;
}

export function replaceRefsWithLabels(
  text: string,
  combinedLabels: Record<string, string>,
): string {
  const keys = Object.keys(combinedLabels).sort((a, b) => b.length - a.length);
  if (keys.length === 0) return text;
  const escaped = keys.map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const regex = new RegExp(`\\b(${escaped.join("|")})\\b`, "g");
  return text.replace(regex, (match) => combinedLabels[match] ?? match);
}

export function RecommendationExplanationBox({
  explainState,
  currentFingerprint,
  itemLabelsByRef,
  refLabels = {},
  showDebug,
  onRetry,
}: RecommendationExplanationBoxProps) {
  if (explainState.status === "idle") {
    return null;
  }

  if (explainState.status === "loading") {
    return (
      <div
        aria-busy="true"
        className="flex flex-col gap-2 rounded-xl border border-[var(--amber)]/40 bg-[var(--amber)]/5 p-4 text-sm"
      >
        <div className="flex items-center gap-2">
          <StatusBadge variant="ai_suggestion" />
          <span className="text-xs text-[var(--text-secondary)]">
            Erklärung wird erstellt…
          </span>
        </div>
      </div>
    );
  }

  if (explainState.status === "error") {
    const isNotConfigured = explainState.errorCode === "not_configured";
    return (
      <div className="flex flex-col gap-2 rounded-xl border border-[var(--amber)]/40 bg-[var(--amber)]/5 p-4 text-sm">
        <div className="flex items-center justify-between gap-2">
          <StatusBadge variant="ai_suggestion" />
          <Button type="button" variant="outline" size="sm" onClick={onRetry}>
            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
            Erneut versuchen
          </Button>
        </div>
        <p className="text-xs text-[var(--text-secondary)]">
          Die Erklärung ist gerade nicht verfügbar – die Empfehlung oben ist
          vollständig.
          {isNotConfigured ? " (KI nicht eingerichtet)" : ""}
        </p>
      </div>
    );
  }

  const { explanation, fingerprint, requestFingerprint, contextJson } =
    explainState;
  if (!explanation) return null;

  const dataChanged = Boolean(
    requestFingerprint && fingerprint && fingerprint !== requestFingerprint,
  );
  if (dataChanged) {
    return (
      <div className="flex flex-col gap-2 rounded-xl border border-[var(--amber)]/45 bg-[var(--amber)]/5 p-4 text-sm">
        <div className="flex items-center justify-between gap-2">
          <StatusBadge variant="ai_suggestion" />
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => window.location.reload()}
          >
            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
            Seite neu laden
          </Button>
        </div>
        <p className="text-xs text-[var(--text-secondary)]">
          Deine Daten haben sich geändert – Seite neu laden.
        </p>
      </div>
    );
  }

  const isStale = fingerprint !== currentFingerprint;
  const combinedLabels: Record<string, string> = {
    ...refLabels,
    ...itemLabelsByRef,
  };

  return (
    <div
      className={cn(
        "flex flex-col gap-3 rounded-xl border border-[var(--amber)]/45 bg-[var(--amber)]/5 p-4 text-sm transition-opacity",
        isStale && "opacity-70",
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <StatusBadge variant="ai_suggestion" />
          {isStale ? (
            <span className="text-xs font-medium text-[var(--amber)]">
              Veraltet – Eingaben wurden geändert
            </span>
          ) : null}
        </div>
        {isStale ? (
          <Button type="button" variant="outline" size="sm" onClick={onRetry}>
            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
            Neu erklären
          </Button>
        ) : null}
      </div>

      <p className="leading-relaxed text-[var(--text-primary)]">
        {replaceRefsWithLabels(explanation.summary, combinedLabels)}
      </p>

      {explanation.items.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {explanation.items.map((item) => (
            <li
              key={item.ref}
              className="rounded-lg border border-[var(--amber)]/25 bg-[var(--surface)] px-3 py-2 text-xs leading-relaxed"
            >
              <span className="font-semibold text-[var(--text-primary)]">
                {itemLabelsByRef[item.ref] ?? item.ref}:{" "}
              </span>
              <span className="text-[var(--text-secondary)]">
                {replaceRefsWithLabels(item.text, combinedLabels)}
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      {explanation.caveats.length > 0 ? (
        <ul className="flex flex-col gap-1 text-xs text-[var(--text-secondary)]">
          {explanation.caveats.map((c, idx) => (
            <li key={idx}>• {replaceRefsWithLabels(c, combinedLabels)}</li>
          ))}
        </ul>
      ) : null}

      {showDebug && contextJson ? (
        <details className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-xs">
          <summary className="cursor-pointer font-medium text-[var(--text-secondary)]">
            Was die KI sieht
          </summary>
          <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-all font-mono text-2xs text-[var(--text-secondary)]">
            {contextJson}
          </pre>
        </details>
      ) : (
        <p className="text-xs text-[var(--text-secondary)]">
          Die KI erhält nur anonymisierte Werte – keine Namen, Konten oder
          Vertragsnummern.
        </p>
      )}
    </div>
  );
}
