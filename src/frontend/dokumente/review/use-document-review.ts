"use client";

import * as React from "react";
import {
  applyPrefillToContractFormValues, createInitialContractFormValues,
  mapApiFieldErrorsToContractErrors, type ContractFieldErrors, type ContractFormValues,
  validateAndBuildContractPayload,
} from "@/frontend/vertraege/contract-form-fields";
import type { FinancialContractRow } from "@/backend/db/queries/contracts";
import type { PropertyRow } from "@/backend/db/queries/properties";
import type { DocumentRow } from "@/backend/db/queries/documents";
import { suggestTaxCategoryForPropertyUsage } from "@/domain/properties/rental";
import {
  buildContractPrefillFromExtraction, buildLoanOptionsDiff,
} from "@/domain/contracts/prefill";
import {
  type ContractCalibrationEvaluation, type DocumentType, evaluateContractCalibration,
  type TaxCategory,
} from "@/domain/documents/documents";
import { centsToEuroInputString, parseEuroInputToCents } from "@/domain/core/money";
import { parseExtractedContractJson } from "@/validation/documents";

export interface DocumentReviewPanelProps {
  pendingDocuments: DocumentRow[];
  selectedDocId: string | null;
  onSelectDoc: (id: string) => void;
  properties: PropertyRow[];
  contracts: FinancialContractRow[];
  todayIsoDate: string;
  onMutated: () => void;
}

export function resolveInitialTaxCategory(
  doc: Pick<DocumentRow, "taxCategory" | "linkedPropertyId">,
  properties: readonly Pick<PropertyRow, "id" | "usage">[],
): TaxCategory {
  if (doc.taxCategory) {
    return doc.taxCategory;
  }
  const linkedProp = properties.find((p) => p.id === doc.linkedPropertyId);
  const suggested = linkedProp
    ? suggestTaxCategoryForPropertyUsage(linkedProp.usage)
    : null;
  return suggested ?? "handwerker_35a";
}


export interface DocumentReviewSplitViewProps {
  doc: DocumentRow;
  properties: PropertyRow[];
  contracts: FinancialContractRow[];
  todayIsoDate: string;
  onMutated: () => void;
}

/** Zustand, Ableitungen und Aktionen von DocumentReviewSplitView. */
export function useDocumentReview({
  doc,
  properties,
  contracts,
  todayIsoDate,
  onMutated,
}: DocumentReviewSplitViewProps) {
  const [documentType, setDocumentType] = React.useState<DocumentType>(
    doc.documentType,
  );
  const [documentDate, setDocumentDate] = React.useState<string>(
    doc.documentDate ?? "",
  );
  const [issuer, setIssuer] = React.useState<string>(doc.issuer ?? "");
  const [totalAmountInput, setTotalAmountInput] = React.useState<string>(
    doc.totalAmountCents != null
      ? centsToEuroInputString(doc.totalAmountCents)
      : "",
  );
  const [linkedPropertyId, setLinkedPropertyId] = React.useState<string>(
    doc.linkedPropertyId ?? "",
  );
  const [linkedContractId, setLinkedContractId] = React.useState<string>(
    doc.linkedContractId ?? "",
  );
  const [isTaxRelevant, setIsTaxRelevant] = React.useState<boolean>(
    doc.isTaxRelevant,
  );
  const [taxYearInput, setTaxYearInput] = React.useState<string>(
    doc.taxYear != null
      ? String(doc.taxYear)
      : doc.documentDate
        ? doc.documentDate.slice(0, 4)
        : "",
  );
  const [hasExplicitTaxCategory, setHasExplicitTaxCategory] = React.useState(
    Boolean(doc.taxCategory),
  );
  const [taxCategory, setTaxCategory] = React.useState<TaxCategory>(() =>
    resolveInitialTaxCategory(doc, properties),
  );
  const [deductibleAmountInput, setDeductibleAmountInput] =
    React.useState<string>(
      doc.deductibleAmountCents != null
        ? centsToEuroInputString(doc.deductibleAmountCents)
        : "",
    );

  const [detectedBalanceInput, setDetectedBalanceInput] =
    React.useState<string>(
      doc.detectedBalanceCents != null
        ? centsToEuroInputString(doc.detectedBalanceCents)
        : "",
    );
  const [calibrationDate, setCalibrationDate] = React.useState<string>(
    doc.documentDate ?? todayIsoDate,
  );
  const [hasEditedCalibrationDate, setHasEditedCalibrationDate] =
    React.useState<boolean>(false);
  const [calibrateContract, setCalibrateContract] =
    React.useState<boolean>(false);
  const [allowOlderCalibrationDate, setAllowOlderCalibrationDate] =
    React.useState<boolean>(false);
  const [applyLoanOptions, setApplyLoanOptions] =
    React.useState<boolean>(false);
  const [extractedContractJson, setExtractedContractJson] = React.useState<
    string | null
  >(doc.extractedContractJson);

  const [isAnalyzing, setIsAnalyzing] = React.useState(false);
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [confirmDelete, setConfirmDelete] = React.useState(false);
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);
  const [aiNotice, setAiNotice] = React.useState<string | null>(null);

  const [contractMode, setContractMode] = React.useState<"existing" | "new">(
    "existing",
  );

  function computeContractPrefillState(targetDoc: DocumentRow) {
    const prefill = buildContractPrefillFromExtraction({
      documentDate: targetDoc.documentDate,
      issuer: targetDoc.issuer,
      detectedBalanceCents: targetDoc.detectedBalanceCents,
      extractedContract: parseExtractedContractJson(
        targetDoc.extractedContractJson,
      ),
      todayIsoDate,
    });
    const base = createInitialContractFormValues(null, todayIsoDate);
    return {
      values: applyPrefillToContractFormValues(
        { ...base, linkedPropertyId: targetDoc.linkedPropertyId ?? "" },
        prefill,
      ),
      reviewHints: prefill.reviewHints,
      hasExtractedLoanOptions: prefill.hasExtractedLoanOptions,
    };
  }

  const initialPrefill = React.useMemo(
    () => computeContractPrefillState(doc),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [doc.id],
  );
  const [newContractValues, setNewContractValues] =
    React.useState<ContractFormValues>(initialPrefill.values);
  const [newContractErrors, setNewContractErrors] =
    React.useState<ContractFieldErrors>({});
  const [contractReviewHints, setContractReviewHints] = React.useState<
    string[]
  >(initialPrefill.reviewHints);
  const [hasPrefilledLoanOptions, setHasPrefilledLoanOptions] =
    React.useState<boolean>(initialPrefill.hasExtractedLoanOptions);

  const selectedContract = React.useMemo(
    () => contracts.find((c) => c.id === linkedContractId) ?? null,
    [contracts, linkedContractId],
  );

  const parsedExtractedContract = React.useMemo(
    () => parseExtractedContractJson(extractedContractJson),
    [extractedContractJson],
  );

  const loanOptionsDiff = React.useMemo(
    () =>
      selectedContract
        ? buildLoanOptionsDiff(selectedContract, parsedExtractedContract)
        : { diffs: [], patch: {} },
    [selectedContract, parsedExtractedContract],
  );

  const effectiveApplyLoanOptions =
    applyLoanOptions &&
    selectedContract?.category === "loan" &&
    loanOptionsDiff.diffs.length > 0;

  // Bauspar-Salden dürfen negativ sein (Abschlussgebühr), Darlehen nicht.
  const allowNegativeBalance = selectedContract
    ? selectedContract.category === "savings_contract"
    : documentType === "bauspar_statement";

  const parsedBalanceCents = React.useMemo(() => {
    if (!detectedBalanceInput.trim()) return null;
    const parsed = parseEuroInputToCents(detectedBalanceInput);
    if (parsed === null) return null;
    return parsed >= 0 || allowNegativeBalance ? parsed : null;
  }, [detectedBalanceInput, allowNegativeBalance]);

  const calibrationEvaluation: ContractCalibrationEvaluation | null =
    React.useMemo(() => {
      if (!selectedContract || parsedBalanceCents === null) {
        return null;
      }
      const candidateDate =
        calibrationDate.trim() || documentDate.trim() || null;
      try {
        return evaluateContractCalibration(
          selectedContract,
          parsedBalanceCents,
          candidateDate,
          todayIsoDate,
        );
      } catch {
        return null;
      }
    }, [
      selectedContract,
      parsedBalanceCents,
      calibrationDate,
      documentDate,
      todayIsoDate,
    ]);

  const isOlderCalibrationBlocked =
    Boolean(calibrationEvaluation?.isOlderThanCurrentCalibration) &&
    !allowOlderCalibrationDate;
  const isCalibrationToggleDisabled =
    parsedBalanceCents === null || isOlderCalibrationBlocked;
  const effectiveCalibrateContract =
    calibrateContract && !isCalibrationToggleDisabled;

  function applyDocumentToForm(updatedDoc: DocumentRow) {
    setDocumentType(updatedDoc.documentType);
    setDocumentDate(updatedDoc.documentDate ?? "");
    setIssuer(updatedDoc.issuer ?? "");
    setTotalAmountInput(
      updatedDoc.totalAmountCents != null
        ? centsToEuroInputString(updatedDoc.totalAmountCents)
        : "",
    );
    setLinkedPropertyId(updatedDoc.linkedPropertyId ?? "");
    setLinkedContractId(updatedDoc.linkedContractId ?? "");
    setIsTaxRelevant(updatedDoc.isTaxRelevant);
    setTaxYearInput(
      updatedDoc.taxYear != null
        ? String(updatedDoc.taxYear)
        : updatedDoc.documentDate
          ? updatedDoc.documentDate.slice(0, 4)
          : "",
    );
    setTaxCategory(resolveInitialTaxCategory(updatedDoc, properties));
    setHasExplicitTaxCategory(Boolean(updatedDoc.taxCategory));
    setDeductibleAmountInput(
      updatedDoc.deductibleAmountCents != null
        ? centsToEuroInputString(updatedDoc.deductibleAmountCents)
        : "",
    );
    setDetectedBalanceInput(
      updatedDoc.detectedBalanceCents != null
        ? centsToEuroInputString(updatedDoc.detectedBalanceCents)
        : "",
    );
    if (!hasEditedCalibrationDate) {
      setCalibrationDate(updatedDoc.documentDate ?? todayIsoDate);
    }
    setAllowOlderCalibrationDate(false);
    setCalibrateContract(false);
    setApplyLoanOptions(false);
    setExtractedContractJson(updatedDoc.extractedContractJson);
    const nextPrefill = computeContractPrefillState(updatedDoc);
    setNewContractValues(nextPrefill.values);
    setContractReviewHints(nextPrefill.reviewHints);
    setHasPrefilledLoanOptions(nextPrefill.hasExtractedLoanOptions);
    setNewContractErrors({});
  }

  async function handleReanalyze() {
    setIsAnalyzing(true);
    setErrorMessage(null);
    setAiNotice(null);

    try {
      const response = await fetch(`/api/documents/${doc.id}/analyze`, {
        method: "POST",
      });
      const body = (await response.json()) as {
        error?: string;
        document?: DocumentRow;
        ai?: { status: string; message?: string; model?: string };
      };

      if (!response.ok) {
        setErrorMessage(body.error ?? "KI-Analyse fehlgeschlagen.");
        return;
      }

      if (body.ai?.status === "extracted" && body.document) {
        applyDocumentToForm(body.document);
        onMutated();
      } else {
        setAiNotice(
          body.ai?.message ??
            "KI-Analyse nicht verfügbar – bitte Werte manuell ergänzen.",
        );
      }
    } catch {
      setErrorMessage("Netzwerkfehler bei der KI-Analyse.");
    } finally {
      setIsAnalyzing(false);
    }
  }

  async function handleVerify(e: React.FormEvent) {
    e.preventDefault();
    setErrorMessage(null);
    setNewContractErrors({});

    const parsedTotal = totalAmountInput.trim()
      ? parseEuroInputToCents(totalAmountInput)
      : null;
    if (totalAmountInput.trim() && (parsedTotal === null || parsedTotal < 0)) {
      setErrorMessage("Bitte einen gültigen nicht-negativen Gesamtbetrag eingeben.");
      return;
    }

    const parsedDeductible =
      isTaxRelevant && deductibleAmountInput.trim()
        ? parseEuroInputToCents(deductibleAmountInput)
        : null;
    if (
      isTaxRelevant &&
      deductibleAmountInput.trim() &&
      (parsedDeductible === null || parsedDeductible < 0)
    ) {
      setErrorMessage(
        "Bitte einen gültigen nicht-negativen absetzbaren Betrag eingeben.",
      );
      return;
    }

    if (
      parsedTotal !== null &&
      parsedDeductible !== null &&
      parsedDeductible > parsedTotal
    ) {
      setErrorMessage(
        "Der absetzbare Betrag darf den Gesamtbetrag nicht übersteigen.",
      );
      return;
    }

    const parsedTaxYear =
      isTaxRelevant && taxYearInput.trim() ? Number(taxYearInput.trim()) : null;
    if (
      isTaxRelevant &&
      taxYearInput.trim() &&
      (!Number.isInteger(parsedTaxYear) ||
        (parsedTaxYear as number) < 1900 ||
        (parsedTaxYear as number) > 2100)
    ) {
      setErrorMessage("Bitte ein gültiges Steuerjahr (JJJJ) eingeben.");
      return;
    }

    if (contractMode === "new") {
      const validatedContract = validateAndBuildContractPayload({
        ...newContractValues,
        linkedPropertyId,
      });
      if (!validatedContract.ok) {
        setNewContractErrors(validatedContract.errors);
        setErrorMessage(
          "Bitte die markierten Pflicht- und Konditionsfelder des neuen Vertrags prüfen.",
        );
        return;
      }

      setIsSubmitting(true);
      try {
        const response = await fetch(`/api/documents/${doc.id}/create-contract`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contract: validatedContract.payload,
            document: {
              documentType,
              documentDate: documentDate.trim() || null,
              issuer: issuer.trim() || null,
              totalAmountCents: parsedTotal,
              linkedPropertyId: linkedPropertyId || null,
              isTaxRelevant,
              taxYear: parsedTaxYear,
              taxCategory: isTaxRelevant ? taxCategory : null,
              deductibleAmountCents: parsedDeductible,
              detectedBalanceCents: doc.detectedBalanceCents,
            },
          }),
        });

        const body = (await response.json()) as {
          error?: string;
          fieldErrors?: Record<string, string>;
        };
        if (!response.ok) {
          setNewContractErrors(
            mapApiFieldErrorsToContractErrors(body.error, body.fieldErrors),
          );
          setErrorMessage(
            body.error ?? "Vertrag anlegen & Freigabe fehlgeschlagen.",
          );
          setIsSubmitting(false);
          return;
        }

        onMutated();
      } catch {
        setErrorMessage("Netzwerkfehler beim Anlegen des Vertrags.");
        setIsSubmitting(false);
      }
      return;
    }

    if (detectedBalanceInput.trim() && parsedBalanceCents === null) {
      setErrorMessage(
        allowNegativeBalance
          ? "Bitte einen gültigen Vertragsstand eingeben."
          : "Bitte einen gültigen nicht-negativen Vertragsstand eingeben.",
      );
      return;
    }

    if (effectiveCalibrateContract && (!linkedContractId || parsedBalanceCents === null)) {
      setErrorMessage(
        "Für die Vertrags-Eichung müssen ein Vertrag und ein gültiger Vertragsstand angegeben sein.",
      );
      return;
    }

    setIsSubmitting(true);
    try {
      const response = await fetch(`/api/documents/${doc.id}/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          documentType,
          documentDate: documentDate.trim() || null,
          issuer: issuer.trim() || null,
          totalAmountCents: parsedTotal,
          linkedPropertyId: linkedPropertyId || null,
          linkedContractId: linkedContractId || null,
          isTaxRelevant,
          taxYear: parsedTaxYear,
          taxCategory: isTaxRelevant ? taxCategory : null,
          deductibleAmountCents: parsedDeductible,
          detectedBalanceCents: parsedBalanceCents,
          calibrateContract: effectiveCalibrateContract,
          calibratedBalanceCents: effectiveCalibrateContract
            ? parsedBalanceCents
            : null,
          calibrationDate: effectiveCalibrateContract
            ? calibrationDate.trim() || null
            : null,
          allowOlderCalibrationDate: effectiveCalibrateContract
            ? allowOlderCalibrationDate
            : false,
          applyLoanOptions: effectiveApplyLoanOptions,
          loanOptions: effectiveApplyLoanOptions ? loanOptionsDiff.patch : null,
        }),
      });

      const body = (await response.json()) as { error?: string };
      if (!response.ok) {
        setErrorMessage(body.error ?? "Freigabe fehlgeschlagen.");
        setIsSubmitting(false);
        return;
      }

      onMutated();
    } catch {
      setErrorMessage("Netzwerkfehler bei der Freigabe.");
      setIsSubmitting(false);
    }
  }

  async function handleDelete() {
    setIsSubmitting(true);
    setErrorMessage(null);
    try {
      const response = await fetch(`/api/documents/${doc.id}`, {
        method: "DELETE",
      });
      if (!response.ok) {
        const body = (await response.json()) as { error?: string };
        setErrorMessage(body.error ?? "Löschen fehlgeschlagen.");
        setIsSubmitting(false);
        return;
      }
      onMutated();
    } catch {
      setErrorMessage("Netzwerkfehler beim Löschen.");
      setIsSubmitting(false);
    }
  }

  return {
    aiNotice,
    allowNegativeBalance,
    allowOlderCalibrationDate,
    applyDocumentToForm,
    applyLoanOptions,
    calibrateContract,
    calibrationDate,
    calibrationEvaluation,
    computeContractPrefillState,
    confirmDelete,
    contractMode,
    contractReviewHints,
    contracts,
    deductibleAmountInput,
    detectedBalanceInput,
    doc,
    documentDate,
    documentType,
    effectiveApplyLoanOptions,
    effectiveCalibrateContract,
    errorMessage,
    extractedContractJson,
    handleDelete,
    handleReanalyze,
    handleVerify,
    hasEditedCalibrationDate,
    hasExplicitTaxCategory,
    hasPrefilledLoanOptions,
    initialPrefill,
    isAnalyzing,
    isCalibrationToggleDisabled,
    isOlderCalibrationBlocked,
    isSubmitting,
    isTaxRelevant,
    issuer,
    linkedContractId,
    linkedPropertyId,
    loanOptionsDiff,
    newContractErrors,
    newContractValues,
    onMutated,
    parsedBalanceCents,
    parsedExtractedContract,
    properties,
    selectedContract,
    setAiNotice,
    setAllowOlderCalibrationDate,
    setApplyLoanOptions,
    setCalibrateContract,
    setCalibrationDate,
    setConfirmDelete,
    setContractMode,
    setContractReviewHints,
    setDeductibleAmountInput,
    setDetectedBalanceInput,
    setDocumentDate,
    setDocumentType,
    setErrorMessage,
    setExtractedContractJson,
    setHasEditedCalibrationDate,
    setHasExplicitTaxCategory,
    setHasPrefilledLoanOptions,
    setIsAnalyzing,
    setIsSubmitting,
    setIsTaxRelevant,
    setIssuer,
    setLinkedContractId,
    setLinkedPropertyId,
    setNewContractErrors,
    setNewContractValues,
    setTaxCategory,
    setTaxYearInput,
    setTotalAmountInput,
    taxCategory,
    taxYearInput,
    todayIsoDate,
    totalAmountInput,
  };
}

export type DocumentReviewState = ReturnType<typeof useDocumentReview>;
