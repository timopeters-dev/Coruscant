"use client";

import { CheckCircle2, Trash2 } from "lucide-react";
import { StatusBadge } from "@/frontend/ui/status-badge";
import { Badge } from "@/frontend/ui/badge";
import { Button } from "@/frontend/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/frontend/ui/card";
import { TextField } from "@/frontend/ui/field";
import { Label } from "@/frontend/ui/label";
import { Select } from "@/frontend/ui/select";
import { suggestTaxCategoryForPropertyUsage } from "@/domain/properties/rental";
import { type DocumentType } from "@/domain/documents/documents";
import { DOCUMENT_TYPE_LABELS, DOCUMENT_TYPE_OPTIONS } from "./labels";
import { DatePicker } from "@/frontend/ui/date-picker";
import {
  SEGMENT_TRACK, SegmentGroup, SegmentLabel, SegmentPill, segmentItemClass,
} from "@/frontend/ui/segmented";
import { cn } from "@/frontend/ui/cn";
import {
  DocumentReviewPanelProps, type DocumentReviewSplitViewProps, useDocumentReview,
} from "./review/use-document-review";
import { ReviewPdfPreview } from "./review/pdf-preview";
import { ReviewTaxSection } from "./review/tax-section";
import { ReviewCalibrationSection } from "./review/calibration-section";
import { ReviewNewContractSection } from "./review/new-contract-section";

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
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface)]  px-4 py-3">
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

function DocumentReviewSplitView(props: DocumentReviewSplitViewProps) {
  const ws = useDocumentReview(props);
  const {
    confirmDelete, contractMode, contracts, documentDate, documentType, errorMessage,
    handleDelete, handleVerify, hasEditedCalibrationDate, hasExplicitTaxCategory, isAnalyzing,
    isSubmitting, issuer, linkedContractId, linkedPropertyId, properties, selectedContract,
    setAllowOlderCalibrationDate, setApplyLoanOptions, setCalibrateContract, setCalibrationDate,
    setConfirmDelete, setContractMode, setDocumentDate, setDocumentType, setErrorMessage,
    setIssuer, setLinkedContractId, setLinkedPropertyId, setNewContractErrors,
    setNewContractValues, setTaxCategory, setTaxYearInput, setTotalAmountInput, taxYearInput,
    todayIsoDate, totalAmountInput,
  } = ws;
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <ReviewPdfPreview ws={ws} />

      {/* Right: AI Suggestion + Verification Form */}
      <Card className="min-w-0 border-[var(--amber)]/35">
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

        <CardContent className="@container">
          <form onSubmit={handleVerify} className="space-y-4">
            {errorMessage ? (
              <div className="rounded-lg border border-[var(--rose)]/40 bg-[var(--rose)]/10 px-3 py-2 text-xs text-[var(--rose)]">
                {errorMessage}
              </div>
            ) : null}

            <div className="grid gap-3 @md:grid-cols-2">
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
                <DatePicker
                  id="doc-date"
                  value={documentDate}
                  onChange={(nextDate) => {
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

            <div className="grid gap-3 @md:grid-cols-2">
              <TextField
                id="doc-issuer"
                label="Aussteller / Bank"
                value={issuer}
                onValueChange={setIssuer}
                placeholder="z. B. Musterbank"
              />

              <TextField
                id="doc-total"
                label="Gesamtbetrag (€)"
                value={totalAmountInput}
                onValueChange={setTotalAmountInput}
                placeholder="z. B. 1.250,00"
              />
            </div>

            <div className="space-y-2">
              <div className="space-y-1.5">
                <Label htmlFor="doc-property">Immobilie (optional)</Label>
                <Select
                  id="doc-property"
                  value={linkedPropertyId}
                  onChange={(e) => {
                    const nextProp = e.target.value;
                    setLinkedPropertyId(nextProp);
                    setNewContractValues((prev) => ({
                      ...prev,
                      linkedPropertyId: nextProp,
                    }));
                    if (!hasExplicitTaxCategory) {
                      const prop = properties.find((p) => p.id === nextProp);
                      const suggested = prop
                        ? suggestTaxCategoryForPropertyUsage(prop.usage)
                        : null;
                      if (suggested) {
                        setTaxCategory(suggested);
                      }
                    }
                  }}
                >
                  <option value="">Keine Immobilie</option>
                  {properties.map((prop) => (
                    <option key={prop.id} value={prop.id}>
                      {prop.name}
                    </option>
                  ))}
                </Select>
              </div>
            </div>

            {/* Mode Switcher: Existing vs. New Contract */}
            <SegmentGroup>
              <div
                role="group"
                aria-label="Vertragszuordnung"
                className={cn(SEGMENT_TRACK, "grid w-full grid-cols-2")}
              >
                {(
                  [
                    { mode: "existing", label: "Bestehendem Vertrag zuordnen" },
                    { mode: "new", label: "Als neuen Vertrag anlegen" },
                  ] as const
                ).map((option) => {
                  const active = contractMode === option.mode;
                  return (
                    <button
                      key={option.mode}
                      type="button"
                      aria-pressed={active}
                      onClick={() => {
                        setContractMode(option.mode);
                        setErrorMessage(null);
                        if (option.mode === "existing") {
                          setNewContractErrors({});
                        }
                      }}
                      disabled={isSubmitting || isAnalyzing}
                      className={cn(
                        segmentItemClass(active),
                        "min-w-0 whitespace-normal py-1.5 text-center disabled:opacity-50",
                      )}
                    >
                      {active ? <SegmentPill /> : null}
                      <SegmentLabel>{option.label}</SegmentLabel>
                    </button>
                  );
                })}
              </div>
            </SegmentGroup>

            {contractMode === "existing" ? (
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
                      setApplyLoanOptions(false);
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
            ) : null}

            <ReviewTaxSection ws={ws} />

            <ReviewCalibrationSection ws={ws} />

            <ReviewNewContractSection ws={ws} />

            {/* Actions */}
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--border)] pt-3">
              <Button
                type="submit"
                variant="default"
                disabled={isSubmitting || isAnalyzing}
              >
                {isSubmitting
                  ? "Speichert..."
                  : contractMode === "new"
                    ? "Vertrag anlegen & Beleg freigeben"
                    : "Freigeben & speichern"}
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
                    variant="destructive"
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
