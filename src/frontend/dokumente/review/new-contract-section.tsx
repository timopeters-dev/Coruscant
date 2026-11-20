"use client";

import { StatusBadge } from "@/frontend/ui/status-badge";
import {
  ContractFormFields, ContractPrefillReviewNotice,
} from "@/frontend/vertraege/contract-form-fields";
import { type DocumentReviewState } from "./use-document-review";

/** Neuen Vertrag direkt aus dem Beleg anlegen. */
export function ReviewNewContractSection({ ws }: { ws: DocumentReviewState }) {
  const {
    contractMode, contractReviewHints, hasPrefilledLoanOptions, isAnalyzing, isSubmitting,
    linkedPropertyId, newContractErrors, newContractValues, properties, setLinkedPropertyId,
    setNewContractValues,
  } = ws;
  return (
    <>
      {/* New Contract Creation Section (new mode) */}
      {contractMode === "new" ? (
        <div className="space-y-4 rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)]/30 p-3.5">
          <div className="flex items-center justify-between gap-2">
            <span className="section-label text-[var(--text-primary)]">
              Neuer Vertrag (Vorausgefüllt)
            </span>
            <StatusBadge variant="ai_suggestion" />
          </div>

          <ContractPrefillReviewNotice hints={contractReviewHints} />

          <ContractFormFields
            values={{ ...newContractValues, linkedPropertyId }}
            onChange={(next) => {
              setNewContractValues(next);
              if (next.linkedPropertyId !== linkedPropertyId) {
                setLinkedPropertyId(next.linkedPropertyId);
              }
            }}
            errors={newContractErrors}
            properties={properties}
            disabled={isSubmitting || isAnalyzing}
            idPrefix="doc-new-contract"
            hasPrefilledLoanOptions={hasPrefilledLoanOptions}
          />
        </div>
      ) : null}
    </>
  );
}
