"use client";

import * as React from "react";
import type { PropertyValuationHistoryRow } from "@/backend/db/schema";
import {
  INITIAL_VALUATION_ADOPTION_STATE, valuationAdoptionReducer,
} from "@/domain/properties/valuation/adoption";
import { api } from "@/frontend/lib/api";
import {
  mapHistoryToSuggestion,
  type PendingSuggestionApiRow,
  type PendingSuggestionView,
  type ValuationStatusResponse,
} from "./view";

function fetchValuationData(propertyId: string) {
  const base = `/api/properties/${encodeURIComponent(propertyId)}/valuation`;
  return Promise.all([
    api<{ requestJson?: string; usable?: boolean }>(base),
    api<{ entries: PropertyValuationHistoryRow[]; pendingSuggestion: PendingSuggestionApiRow | null }>(`${base}/history`),
    api<ValuationStatusResponse>("/api/valuation/status"),
  ]);
}

const CONTEXT_MISSING = "PLZ, Wohnfläche und Objekttyp pflegen, um eine Schätzung zu erhalten.";

/**
 * Lädt Vorschau, Verlauf und Kontingent einer Immobilie und hält den offenen
 * Vorschlag samt Übernahme-Zustand. `reload()` nach jeder Änderung aufrufen.
 */
export function useValuationData(propertyId: string, propertyUpdatedAt: string) {
  const [previewJson, setPreviewJson] = React.useState<string | null>(null);
  const [contextUnavailable, setContextUnavailable] = React.useState<string | null>(null);
  const [historyEntries, setHistoryEntries] = React.useState<PropertyValuationHistoryRow[]>([]);
  const [statusData, setStatusData] = React.useState<ValuationStatusResponse | null>(null);
  const [suggestion, setSuggestionState] = React.useState<PendingSuggestionView | null>(null);
  const suggestionRef = React.useRef<PendingSuggestionView | null>(null);
  const [adoptionState, dispatch] = React.useReducer(valuationAdoptionReducer, INITIAL_VALUATION_ADOPTION_STATE);

  const setSuggestion = React.useCallback((next: PendingSuggestionView | null) => {
    suggestionRef.current = next;
    setSuggestionState(next);
  }, []);

  const apply = React.useCallback(
    ([preview, history, status]: Awaited<ReturnType<typeof fetchValuationData>>) => {

      if (preview.ok && preview.data.usable) {
        setPreviewJson(preview.data.requestJson ?? null);
        setContextUnavailable(null);
      } else {
        setPreviewJson(null);
        if (!preview.ok && preview.status === 422) setContextUnavailable(preview.error ?? CONTEXT_MISSING);
      }

      if (history.ok) {
        const { entries, pendingSuggestion } = history.data;
        setHistoryEntries(entries);
        if (!pendingSuggestion) {
          setSuggestion(null);
          dispatch({ type: "reset" });
        } else {
          const mapped = mapHistoryToSuggestion(pendingSuggestion);
          const current = suggestionRef.current;
          if (current?.historyId === mapped.historyId) {
            // Gleicher Vorschlag: nur die Zu-/Abschläge aktualisieren, Details behalten.
            setSuggestion({
              ...current,
              adjustmentBps: mapped.adjustmentBps,
              adjustedLowerCents: mapped.adjustedLowerCents,
              adjustedMedianCents: mapped.adjustedMedianCents,
              adjustedUpperCents: mapped.adjustedUpperCents,
            });
          } else {
            setSuggestion(mapped);
            dispatch({ type: "suggest", historyId: mapped.historyId });
          }
        }
      }

      if (status.ok) setStatusData(status.data);
    },
    [setSuggestion],
  );

  React.useEffect(() => {
    let cancelled = false;
    void fetchValuationData(propertyId).then((result) => {
      if (!cancelled) apply(result);
    });
    return () => {
      cancelled = true;
    };
  }, [apply, propertyId, propertyUpdatedAt]);

  return {
    previewJson,
    setPreviewJson,
    contextUnavailable,
    setContextUnavailable,
    historyEntries,
    statusData,
    suggestion,
    setSuggestion,
    adoptionState,
    dispatch,
    reload: async () => apply(await fetchValuationData(propertyId)),
    contextMissingMessage: CONTEXT_MISSING,
  };
}
