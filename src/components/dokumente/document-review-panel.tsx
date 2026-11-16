"use client";

import * as React from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  Loader2,
  Sparkles,
  Trash2,
} from "lucide-react";
import { StatusBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import type { FinancialContractRow, PropertyRow } from "@/db/queries/contracts";
import type { DocumentRow } from "@/db/queries/documents";
import {
  type ContractCalibrationEvaluation,
  type DocumentType,
  evaluateContractCalibration,
  TAX_CATEGORIES,
  type TaxCategory,
} from "@/lib/domain/documents";
import {
  centsToEuroInputString,
  formatCentsDE,
  parseEuroInputToCents,
} from "@/lib/domain/money";
import {
  DOCUMENT_TYPE_LABELS,
  DOCUMENT_TYPE_OPTIONS,
  TAX_CATEGORY_LABELS,
} from "./labels";

interface DocumentReviewPanelProps {
  pendingDocuments: DocumentRow[];
  selectedDocId: string | null;
  onSelectDoc: (id: string) => void;
  properties: PropertyRow[];
  contracts: FinancialContractRow[];
  todayIsoDate: string;
  onMutated: () => void;
}

export function DocumentReviewPanel({
  pendingDocuments,
  selectedDocId,
  onSelectDoc,
  properties,
  contracts,
  todayIsoDate,
  onMutated,
}: DocumentReviewPanelProps) {
  if (pendingDocuments.length === 0) {
    return (
      <Card className="border-dashed">
        <CardContent className="flex flex-col items-center justify-center py-10 text-center">
          <CheckCircle2
            className="mb-2 h-8 w-8 text-[var(--emerald)]"
            aria-hidden="true"
          />
          <p className="text-sm font-medium text-[var(--text-primary)]">
            Keine offenen Belege zur Prüfung
          </p>
          <p className="mt-1 text-xs text-[var(--text-secondary)]">
            Alle hochgeladenen Dokumente wurden bereits geprüft und freigegeben.
          </p>
        </CardContent>
      </Card>
    );
  }

  const activeDoc =
    pendingDocuments.find((d) => d.id === selectedDocId) ?? pendingDocuments[0];

  if (!activeDoc) {
    return null;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-[var(--text-primary)]">
            Prüf-Warteschlange
          </span>
          <Badge className="tabular-nums">{pendingDocuments.length}</Badge>
        </div>

        {pendingDocuments.length > 1 ? (
          <div className="flex flex-wrap gap-1.5">
            {pendingDocuments.map((doc) => {
              const isSelected = doc.id === activeDoc.id;
              return (
                <button
                  key={doc.id}
                  type="button"
                  onClick={() => onSelectDoc(doc.id)}
                  className={`max-w-[220px] truncate rounded-lg border px-2.5 py-1 text-xs transition-colors ${
                    isSelected
                      ? "border-[var(--accent)] bg-[var(--accent)]/10 font-medium text-[var(--accent)]"
                      : "border-[var(--border)] bg-[var(--surface-elevated)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                  }`}
                  title={doc.filename}
                >
                  {doc.filename}
                </button>
              );
            })}
          </div>
        ) : null}
      </div>

      <DocumentReviewSplitView
        key={activeDoc.id}
        doc={activeDoc}
        properties={properties}
        contracts={contracts}
        todayIsoDate={todayIsoDate}
        onMutated={onMutated}
      />
    </div>
  );
}

interface DocumentReviewSplitViewProps {
  doc: DocumentRow;
  properties: PropertyRow[];
  contracts: FinancialContractRow[];
  todayIsoDate: string;
  onMutated: () => void;
}

function DocumentReviewSplitView({
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
  const [taxCategory, setTaxCategory] = React.useState<TaxCategory>(
    doc.taxCategory ?? "handwerker_35a",
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

  const [isAnalyzing, setIsAnalyzing] = React.useState(false);
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [confirmDelete, setConfirmDelete] = React.useState(false);
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);
  const [aiNotice, setAiNotice] = React.useState<string | null>(null);

  const selectedContract = React.useMemo(
    () => contracts.find((c) => c.id === linkedContractId) ?? null,
    [contracts, linkedContractId],
  );

  const parsedBalanceCents = React.useMemo(() => {
    if (!detectedBalanceInput.trim()) return null;
    const parsed = parseEuroInputToCents(detectedBalanceInput);
    return parsed !== null && parsed >= 0 ? parsed : null;
  }, [detectedBalanceInput]);

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
    setTaxCategory(updatedDoc.taxCategory ?? "handwerker_35a");
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

    if (detectedBalanceInput.trim() && parsedBalanceCents === null) {
      setErrorMessage(
        "Bitte einen gültigen nicht-negativen Vertragsstand eingeben.",
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

  return (
    <div className="grid gap-4 lg:grid-cols-12">
      {/* Left: PDF Viewer */}
      <Card className="lg:col-span-7">
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 pb-3">
          <div className="min-w-0">
            <CardTitle className="truncate text-base">{doc.filename}</CardTitle>
            <p className="tabular-nums text-xs text-[var(--text-secondary)]">
              Hochgeladen am {doc.createdAt.slice(0, 10)}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleReanalyze}
              disabled={isAnalyzing || isSubmitting}
            >
              {isAnalyzing ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Sparkles className="h-3.5 w-3.5 text-[var(--amber)]" />
              )}
              KI-Analyse erneut starten
            </Button>
            <a
              href={`/api/documents/${doc.id}/file`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 text-xs font-medium text-[var(--text-primary)] transition-colors hover:bg-[var(--surface-elevated)]"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              In neuem Tab öffnen
            </a>
          </div>
        </CardHeader>
        <CardContent>
          {aiNotice ? (
            <div className="mb-3 rounded-lg border border-[var(--amber)]/40 bg-[var(--amber)]/10 px-3 py-2 text-xs text-[var(--amber)]">
              {aiNotice}
            </div>
          ) : null}
          <iframe
            src={`/api/documents/${doc.id}/file`}
            title={doc.filename}
            className="h-[640px] w-full rounded-lg border border-[var(--border)] bg-[var(--surface-elevated)]"
          />
        </CardContent>
      </Card>

      {/* Right: AI Suggestion + Verification Form */}
      <Card className="border-[var(--amber)]/35 lg:col-span-5">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-2">
            <CardTitle className="text-base">Beleg prüfen &amp; freigeben</CardTitle>
            <StatusBadge variant="ai_suggestion" />
          </div>
          <p className="text-xs text-[var(--text-secondary)]">
            Werte prüfen und per 1-Klick bestätigen. Bestandsdaten werden erst
            bei Freigabe aktualisiert.
          </p>
        </CardHeader>

        <CardContent>
          <form onSubmit={handleVerify} className="space-y-4">
            {errorMessage ? (
              <div className="rounded-lg border border-[var(--rose)]/40 bg-[var(--rose)]/10 px-3 py-2 text-xs text-[var(--rose)]">
                {errorMessage}
              </div>
            ) : null}

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="doc-type">Dokumenttyp</Label>
                <Select
                  id="doc-type"
                  value={documentType}
                  onChange={(e) =>
                    setDocumentType(e.target.value as DocumentType)
                  }
                >
                  {DOCUMENT_TYPE_OPTIONS.map((type) => (
                    <option key={type} value={type}>
                      {DOCUMENT_TYPE_LABELS[type]}
                    </option>
                  ))}
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="doc-date">Belegdatum</Label>
                <Input
                  id="doc-date"
                  type="date"
                  value={documentDate}
                  onChange={(e) => {
                    const nextDate = e.target.value;
                    setDocumentDate(nextDate);
                    if (!hasEditedCalibrationDate) {
                      const nextCalDate = nextDate || todayIsoDate;
                      setCalibrationDate(nextCalDate);
                      setAllowOlderCalibrationDate(false);
                      if (
                        selectedContract &&
                        nextCalDate < selectedContract.balanceAsOfDate
                      ) {
                        setCalibrateContract(false);
                      }
                    }
                    if (nextDate && !taxYearInput) {
                      setTaxYearInput(nextDate.slice(0, 4));
                    }
                  }}
                />
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="doc-issuer">Aussteller / Bank</Label>
                <Input
                  id="doc-issuer"
                  placeholder="z. B. Musterbank"
                  value={issuer}
                  onChange={(e) => setIssuer(e.target.value)}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="doc-total">Gesamtbetrag (€)</Label>
                <Input
                  id="doc-total"
                  placeholder="z. B. 1.250,00"
                  className="tabular-nums"
                  value={totalAmountInput}
                  onChange={(e) => setTotalAmountInput(e.target.value)}
                />
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="doc-property">Immobilie (optional)</Label>
                <Select
                  id="doc-property"
                  value={linkedPropertyId}
                  onChange={(e) => setLinkedPropertyId(e.target.value)}
                >
                  <option value="">Keine Immobilie</option>
                  {properties.map((prop) => (
                    <option key={prop.id} value={prop.id}>
                      {prop.name}
                    </option>
                  ))}
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="doc-contract">Vertrag (optional)</Label>
                <Select
                  id="doc-contract"
                  value={linkedContractId}
                  onChange={(e) => {
                    const nextId = e.target.value;
                    if (nextId !== linkedContractId) {
                      setLinkedContractId(nextId);
                      setCalibrateContract(false);
                      setAllowOlderCalibrationDate(false);
                    }
                  }}
                >
                  <option value="">Kein Vertrag</option>
                  {contracts.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </Select>
              </div>
            </div>

            {/* Tax Tagging Section */}
            <div className="space-y-3 rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)]/40 p-3.5">
              <label className="flex cursor-pointer items-center gap-2 text-sm font-medium text-[var(--text-primary)]">
                <input
                  type="checkbox"
                  checked={isTaxRelevant}
                  onChange={(e) => setIsTaxRelevant(e.target.checked)}
                  className="h-4 w-4 rounded border-[var(--border)] accent-[var(--accent)]"
                />
                <span>Steuerrelevant</span>
              </label>

              {isTaxRelevant ? (
                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="doc-tax-year">Steuerjahr</Label>
                    <Input
                      id="doc-tax-year"
                      type="number"
                      min={1900}
                      max={2100}
                      className="tabular-nums"
                      value={taxYearInput}
                      onChange={(e) => setTaxYearInput(e.target.value)}
                    />
                  </div>

                  <div className="space-y-1.5 sm:col-span-2">
                    <Label htmlFor="doc-tax-category">Steuer-Kategorie</Label>
                    <Select
                      id="doc-tax-category"
                      value={taxCategory}
                      onChange={(e) =>
                        setTaxCategory(e.target.value as TaxCategory)
                      }
                    >
                      {TAX_CATEGORIES.map((cat) => (
                        <option key={cat} value={cat}>
                          {TAX_CATEGORY_LABELS[cat]}
                        </option>
                      ))}
                    </Select>
                  </div>

                  <div className="space-y-1.5 sm:col-span-3">
                    <Label htmlFor="doc-deductible">
                      Absetzbarer Betrag / Lohnanteil (€)
                    </Label>
                    <Input
                      id="doc-deductible"
                      placeholder="z. B. 840,00"
                      className="tabular-nums"
                      value={deductibleAmountInput}
                      onChange={(e) => setDeductibleAmountInput(e.target.value)}
                    />
                  </div>
                </div>
              ) : null}
            </div>

            {/* Contract Calibration Section */}
            {selectedContract ? (
              <div className="space-y-3 rounded-xl border border-[var(--amber)]/35 bg-[var(--amber)]/5 p-3.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold uppercase tracking-wide text-[var(--text-primary)]">
                    Vertrags-Eichung
                  </span>
                  <span className="tabular-nums text-xs text-[var(--text-secondary)]">
                    Aktuell: {formatCentsDE(selectedContract.currentBalanceCents)}{" "}
                    (per {selectedContract.balanceAsOfDate})
                  </span>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="doc-balance">
                      Erkannter / neuer Stand (€)
                    </Label>
                    <Input
                      id="doc-balance"
                      placeholder="z. B. 295.000,00"
                      className="tabular-nums"
                      value={detectedBalanceInput}
                      onChange={(e) => {
                        const nextVal = e.target.value;
                        setDetectedBalanceInput(nextVal);
                        const parsed = nextVal.trim()
                          ? parseEuroInputToCents(nextVal)
                          : null;
                        if (parsed === null || parsed < 0) {
                          setCalibrateContract(false);
                        }
                      }}
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="doc-cal-date">Eich-Stichtag</Label>
                    <Input
                      id="doc-cal-date"
                      type="date"
                      className="tabular-nums"
                      value={calibrationDate}
                      onChange={(e) => {
                        const nextCalDate = e.target.value;
                        setHasEditedCalibrationDate(true);
                        setCalibrationDate(nextCalDate);
                        setAllowOlderCalibrationDate(false);
                        const effectiveDate =
                          nextCalDate.trim() ||
                          documentDate.trim() ||
                          todayIsoDate;
                        if (
                          selectedContract &&
                          effectiveDate < selectedContract.balanceAsOfDate
                        ) {
                          setCalibrateContract(false);
                        }
                      }}
                    />
                  </div>
                </div>

                {calibrationEvaluation ? (
                  <div className="space-y-1 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-2.5 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="text-[var(--text-secondary)]">
                        Projizierter Stand per{" "}
                        <span className="tabular-nums">
                          {calibrationEvaluation.effectiveDate}
                        </span>
                      </span>
                      <span className="tabular-nums font-medium text-[var(--text-primary)]">
                        {formatCentsDE(
                          calibrationEvaluation.projectedBalanceAtDateCents,
                        )}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-[var(--text-secondary)]">
                        Delta zum gespeicherten Stand
                      </span>
                      <span className="tabular-nums font-medium text-[var(--text-primary)]">
                        {formatCentsDE(calibrationEvaluation.deltaToStoredCents, {
                          showPlusSign: true,
                        })}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-[var(--text-secondary)]">
                        Delta zur Projektion
                      </span>
                      <span className="tabular-nums font-medium text-[var(--amber)]">
                        {formatCentsDE(
                          calibrationEvaluation.deltaToProjectedCents,
                          { showPlusSign: true },
                        )}
                      </span>
                    </div>
                  </div>
                ) : null}

                {calibrationEvaluation?.isOlderThanCurrentCalibration ? (
                  <div className="space-y-2 rounded-lg border border-[var(--amber)]/50 bg-[var(--amber)]/10 p-2.5 text-xs text-[var(--amber)]">
                    <div className="flex items-start gap-2">
                      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      <span>
                        Vertrag ist bereits auf neueres Datum (
                        <span className="tabular-nums font-semibold">
                          {calibrationEvaluation.previousAsOfDate}
                        </span>
                        ) geeicht als das Belegdatum (
                        <span className="tabular-nums font-semibold">
                          {calibrationEvaluation.effectiveDate}
                        </span>
                        ).
                      </span>
                    </div>
                    <label className="flex cursor-pointer items-center gap-2 text-[var(--text-primary)]">
                      <input
                        type="checkbox"
                        checked={allowOlderCalibrationDate}
                        onChange={(e) => {
                          const checked = e.target.checked;
                          setAllowOlderCalibrationDate(checked);
                          if (!checked) {
                            setCalibrateContract(false);
                          }
                        }}
                        className="h-3.5 w-3.5 rounded accent-[var(--amber)]"
                      />
                      <span>Älteres Eichdatum trotzdem übernehmen</span>
                    </label>
                  </div>
                ) : null}

                <label
                  className={`flex items-center gap-2 text-xs font-medium ${
                    isCalibrationToggleDisabled
                      ? "cursor-not-allowed text-[var(--text-secondary)] opacity-60"
                      : "cursor-pointer text-[var(--text-primary)]"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={effectiveCalibrateContract}
                    disabled={isCalibrationToggleDisabled}
                    onChange={(e) => setCalibrateContract(e.target.checked)}
                    className="h-4 w-4 rounded accent-[var(--accent)]"
                  />
                  <span>
                    Vertragsstand auf{" "}
                    <span className="tabular-nums">
                      {parsedBalanceCents !== null
                        ? formatCentsDE(parsedBalanceCents)
                        : "–"}
                    </span>{" "}
                    per{" "}
                    <span className="tabular-nums">
                      {calibrationEvaluation?.effectiveDate ?? todayIsoDate}
                    </span>{" "}
                    eichen
                  </span>
                </label>
              </div>
            ) : null}

            {/* Actions */}
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--border)] pt-3">
              <Button
                type="submit"
                variant="default"
                disabled={isSubmitting || isAnalyzing}
              >
                {isSubmitting ? "Speichert..." : "Freigeben & speichern"}
              </Button>

              {!confirmDelete ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setConfirmDelete(true)}
                  disabled={isSubmitting || isAnalyzing}
                  className="text-[var(--rose)] hover:border-[var(--rose)]/50"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Löschen
                </Button>
              ) : (
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    size="sm"
                    onClick={handleDelete}
                    disabled={isSubmitting}
                    className="bg-[var(--rose)] text-white hover:opacity-90"
                  >
                    Endgültig löschen
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => setConfirmDelete(false)}
                    disabled={isSubmitting}
                  >
                    Abbrechen
                  </Button>
                </div>
              )}
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
