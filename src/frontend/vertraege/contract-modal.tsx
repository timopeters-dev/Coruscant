"use client";

import * as React from "react";
import { FileText, Loader2, Sparkles, Upload, X } from "lucide-react";
import { StatusBadge } from "@/frontend/ui/status-badge";
import { Button } from "@/frontend/ui/button";
import { Dialog } from "@/frontend/ui/dialog";
import type { FinancialContractRow } from "@/backend/db/queries/contracts";
import type { PropertyRow } from "@/backend/db/queries/properties";
import type { DocumentRow } from "@/backend/db/queries/documents";
import { buildContractPrefillFromExtraction } from "@/domain/contracts/prefill";
import {
  bpsToPercentInputString,
  centsToEuroInputString,
} from "@/domain/core/money";
import { parseExtractedContractJson } from "@/validation/documents";
import type { ContractLoanDraft } from "@/validation/property-draft";
import {
  applyPrefillToContractFormValues,
  ContractFormFields,
  ContractPrefillReviewNotice,
  createInitialContractFormValues,
  mapApiFieldErrorsToContractErrors,
  type ContractFieldErrors,
  type ContractFormValues,
  validateAndBuildContractPayload,
} from "./contract-form-fields";

interface ContractModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  properties: PropertyRow[];
  asOfDate: string;
  initialContract?: FinancialContractRow | null;
  draft?: ContractLoanDraft | null;
  onSaved: () => void;
}

const MAX_PDF_BYTES = 20 * 1024 * 1024;

export function ContractModal({
  open,
  onOpenChange,
  properties,
  asOfDate,
  initialContract,
  draft,
  onSaved,
}: ContractModalProps) {
  if (!open) {
    return null;
  }

  return (
    <ContractModalInner
      key={
        initialContract?.id ??
        (draft ? `draft-${draft.linkedPropertyId}` : "new")
      }
      open={open}
      onOpenChange={onOpenChange}
      properties={properties}
      asOfDate={asOfDate}
      initialContract={initialContract}
      draft={draft}
      onSaved={onSaved}
    />
  );
}

function ContractModalInner({
  open,
  onOpenChange,
  properties,
  asOfDate,
  initialContract,
  draft,
  onSaved,
}: ContractModalProps) {
  const isEditing = Boolean(initialContract);

  const [values, setValues] = React.useState<ContractFormValues>(() => {
    const base = createInitialContractFormValues(initialContract, asOfDate);
    if (!initialContract && draft) {
      return {
        ...base,
        category: draft.category,
        repaymentType: draft.repaymentType,
        currentBalanceEuro: centsToEuroInputString(draft.currentBalanceCents),
        monthlyRateEuro: centsToEuroInputString(draft.monthlyRateCents),
        interestRatePercent: bpsToPercentInputString(draft.interestRateBps),
        linkedPropertyId: draft.linkedPropertyId,
        balanceAsOfDate: draft.balanceAsOfDate,
        fixedInterestUntil: draft.fixedInterestUntil ?? "",
      };
    }
    return base;
  });
  const [errors, setErrors] = React.useState<ContractFieldErrors>({});
  const [isSubmitting, setIsSubmitting] = React.useState(false);

  // PDF prefill state (only used when !isEditing)
  const fileInputRef = React.useRef<HTMLInputElement | null>(null);
  const [isUploadingPdf, setIsUploadingPdf] = React.useState(false);
  const [isAdoptingDuplicate, setIsAdoptingDuplicate] = React.useState(false);
  const [attachedDocument, setAttachedDocument] =
    React.useState<DocumentRow | null>(null);
  const [duplicateCandidate, setDuplicateCandidate] =
    React.useState<DocumentRow | null>(null);
  const [reviewHints, setReviewHints] = React.useState<string[]>([]);
  const [pdfError, setPdfError] = React.useState<string | null>(null);
  const [pdfNotice, setPdfNotice] = React.useState<string | null>(null);
  const [aiExtractedOk, setAiExtractedOk] = React.useState(false);
  const [hasPrefilledLoanOptions, setHasPrefilledLoanOptions] =
    React.useState(false);

  function applyDocumentPrefill(
    doc: DocumentRow,
    extractedOk: boolean,
    fallbackMessage?: string,
  ) {
    const extractedContract = parseExtractedContractJson(
      doc.extractedContractJson,
    );
    const prefill = buildContractPrefillFromExtraction({
      documentDate: doc.documentDate,
      issuer: doc.issuer,
      detectedBalanceCents: doc.detectedBalanceCents,
      extractedContract,
      todayIsoDate: asOfDate,
    });

    setAttachedDocument(doc);
    setDuplicateCandidate(null);
    setHasPrefilledLoanOptions(prefill.hasExtractedLoanOptions);
    setValues((prev) =>
      applyPrefillToContractFormValues(
        {
          ...prev,
          linkedPropertyId:
            prev.linkedPropertyId || doc.linkedPropertyId || "",
        },
        prefill,
      ),
    );
    setReviewHints(prefill.reviewHints);
    setAiExtractedOk(extractedOk);
    setPdfError(null);
    setPdfNotice(fallbackMessage ?? null);
  }

  async function handlePdfFileChange(
    event: React.ChangeEvent<HTMLInputElement>,
  ) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    setPdfError(null);
    setPdfNotice(null);
    setDuplicateCandidate(null);

    if (file.size > MAX_PDF_BYTES) {
      setPdfError("Die PDF-Datei überschreitet das Limit von 20 MB.");
      return;
    }

    setIsUploadingPdf(true);
    try {
      const formData = new FormData();
      formData.append("file", file);

      const response = await fetch("/api/documents", {
        method: "POST",
        body: formData,
      });

      const body = (await response.json()) as {
        error?: string;
        document?: DocumentRow;
        existingDocument?: DocumentRow;
        ai?: { status: string; message?: string; model?: string };
      };

      if (response.status === 409 && body.existingDocument) {
        const existing = body.existingDocument;
        if (existing.linkedContractId) {
          setPdfError(
            `Dieses PDF („${existing.filename}“) ist bereits einem bestehenden Vertrag zugeordnet und kann nicht erneut verknüpft werden.`,
          );
        } else {
          setDuplicateCandidate(existing);
        }
        return;
      }

      if (!response.ok || !body.document) {
        setPdfError(body.error ?? "PDF-Upload fehlgeschlagen.");
        return;
      }

      const extractedOk = body.ai?.status === "extracted";
      applyDocumentPrefill(
        body.document,
        extractedOk,
        extractedOk
          ? undefined
          : (body.ai?.message ??
              "KI-Analyse nicht verfügbar – Felder wurden so weit wie möglich vorbelegt."),
      );
    } catch {
      setPdfError("Netzwerkfehler beim Hochladen der PDF-Datei.");
    } finally {
      setIsUploadingPdf(false);
    }
  }

  async function handleAdoptDuplicate() {
    if (!duplicateCandidate) return;

    setIsAdoptingDuplicate(true);
    setPdfError(null);
    setPdfNotice(null);

    try {
      let targetDoc = duplicateCandidate;
      let extractedOk = Boolean(targetDoc.extractedContractJson);
      let notice: string | undefined;

      if (
        targetDoc.status === "pending_review" &&
        targetDoc.extractedContractJson === null
      ) {
        const analyzeRes = await fetch(
          `/api/documents/${targetDoc.id}/analyze`,
          { method: "POST" },
        );
        if (analyzeRes.ok) {
          const analyzeBody = (await analyzeRes.json()) as {
            document?: DocumentRow;
            ai?: { status: string; message?: string };
          };
          if (analyzeBody.document) {
            targetDoc = analyzeBody.document;
          }
          extractedOk = analyzeBody.ai?.status === "extracted";
          if (!extractedOk && analyzeBody.ai?.message) {
            notice = analyzeBody.ai.message;
          }
        }
      }

      applyDocumentPrefill(targetDoc, extractedOk, notice);
    } catch {
      setPdfError("Netzwerkfehler beim Übernehmen des vorhandenen Dokuments.");
    } finally {
      setIsAdoptingDuplicate(false);
    }
  }

  function handleDetachPdf() {
    setAttachedDocument(null);
    setDuplicateCandidate(null);
    setReviewHints([]);
    setPdfError(null);
    setPdfNotice(null);
    setAiExtractedOk(false);
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const validated = validateAndBuildContractPayload(values);
    if (!validated.ok) {
      setErrors(validated.errors);
      return;
    }

    setIsSubmitting(true);
    setErrors({});

    try {
      let response: Response;
      if (initialContract) {
        response = await fetch(`/api/contracts/${initialContract.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(validated.payload),
        });
      } else if (attachedDocument) {
        response = await fetch(
          `/api/documents/${attachedDocument.id}/create-contract`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ contract: validated.payload }),
          },
        );
      } else {
        response = await fetch("/api/contracts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(validated.payload),
        });
      }

      const data = (await response.json()) as {
        error?: string;
        fieldErrors?: Record<string, string>;
      };

      if (!response.ok) {
        setErrors(mapApiFieldErrorsToContractErrors(data.error, data.fieldErrors));
        setIsSubmitting(false);
        return;
      }

      onOpenChange(false);
      onSaved();
    } catch {
      setErrors({
        general: "Netzwerkfehler beim Speichern des Vertrags.",
      });
      setIsSubmitting(false);
    }
  }

  const busy = isSubmitting || isUploadingPdf || isAdoptingDuplicate;

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={isEditing ? "Vertrag bearbeiten" : "Neuen Vertrag anlegen"}
      description="Generische Erfassung für Kredite, Darlehen und Bausparverträge."
      className="max-w-2xl"
    >
      <form onSubmit={handleSubmit} className="space-y-5">
        {!isEditing ? (
          <div className="space-y-3 rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)]/50 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Sparkles
                  className="h-4 w-4 text-[var(--amber)]"
                  aria-hidden="true"
                />
                <span className="section-label text-[var(--text-primary)]">
                  Aus PDF vorbefüllen (KI)
                </span>
              </div>

              <input
                ref={fileInputRef}
                type="file"
                accept="application/pdf,.pdf"
                onChange={handlePdfFileChange}
                className="hidden"
                disabled={busy}
              />

              {!attachedDocument ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={busy}
                >
                  {isUploadingPdf ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Upload className="h-3.5 w-3.5" />
                  )}
                  {isUploadingPdf
                    ? "PDF wird analysiert..."
                    : "PDF hochladen (max. 20 MB)"}
                </Button>
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleDetachPdf}
                  disabled={busy}
                >
                  <X className="h-3.5 w-3.5" />
                  PDF-Verknüpfung entfernen
                </Button>
              )}
            </div>

            {!attachedDocument && !duplicateCandidate && !pdfError ? (
              <p className="text-xs text-[var(--text-secondary)]">
                Optional: Kredit- oder Bausparvertrag (PDF) hochladen, um
                Konditionen automatisch vorzuschlagen. Bei Abbruch bleibt der
                Beleg in der Dokumenten-Inbox.
              </p>
            ) : null}

            {pdfError ? (
              <div className="rounded-lg border border-[var(--rose)]/40 bg-[var(--rose)]/10 px-3 py-2 text-xs text-[var(--rose)]">
                {pdfError}
              </div>
            ) : null}

            {duplicateCandidate ? (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--amber)]/40 bg-[var(--amber)]/10 px-3 py-2 text-xs">
                <span className="text-[var(--text-primary)]">
                  Dieses PDF („{duplicateCandidate.filename}“) liegt bereits in
                  der Dokumenten-Inbox vor.
                </span>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={handleAdoptDuplicate}
                  disabled={busy}
                >
                  {isAdoptingDuplicate ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : null}
                  Vorhandenes Dokument übernehmen
                </Button>
              </div>
            ) : null}

            {attachedDocument ? (
              <div className="space-y-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-xs">
                  <div className="flex min-w-0 items-center gap-2">
                    <FileText
                      className="h-3.5 w-3.5 shrink-0 text-[var(--accent)]"
                      aria-hidden="true"
                    />
                    <span className="truncate font-medium text-[var(--text-primary)]">
                      {attachedDocument.filename}
                    </span>
                  </div>
                  {aiExtractedOk ? (
                    <StatusBadge variant="ai_suggestion" />
                  ) : (
                    <span className="text-[var(--text-secondary)]">
                      Ohne KI-Vorschlag verknüpft
                    </span>
                  )}
                </div>

                {pdfNotice ? (
                  <p className="text-xs text-[var(--amber)]">{pdfNotice}</p>
                ) : null}

                <ContractPrefillReviewNotice hints={reviewHints} />
              </div>
            ) : null}
          </div>
        ) : null}

        {errors.general ? (
          <div className="rounded-lg border border-[var(--rose)]/40 bg-[var(--rose)]/10 px-3 py-2 text-xs text-[var(--rose)]">
            {errors.general}
          </div>
        ) : null}

        <ContractFormFields
          values={values}
          onChange={setValues}
          errors={errors}
          properties={properties}
          disabled={busy}
          idPrefix="contract"
          hasPrefilledLoanOptions={hasPrefilledLoanOptions}
        />

        <div className="flex justify-end gap-2 border-t border-[var(--border)] pt-4">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={busy}
          >
            Abbrechen
          </Button>
          <Button type="submit" disabled={busy}>
            {isSubmitting
              ? "Speichert..."
              : isEditing
                ? "Änderungen speichern"
                : attachedDocument
                  ? "Vertrag anlegen & PDF verknüpfen"
                  : "Vertrag anlegen"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
