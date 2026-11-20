"use client";

/** Metadaten eines Belegs bearbeiten (Typ, Datum, Steuer, Verknüpfungen). */
import * as React from "react";
import { Button } from "@/frontend/ui/button";
import { Dialog } from "@/frontend/ui/dialog";
import { Input } from "@/frontend/ui/input";
import { Label } from "@/frontend/ui/label";
import { Select } from "@/frontend/ui/select";
import type { FinancialContractRow } from "@/backend/db/queries/contracts";
import type { PropertyRow } from "@/backend/db/queries/properties";
import type { DocumentRow } from "@/backend/db/queries/documents";
import { type DocumentType, TAX_CATEGORIES, type TaxCategory } from "@/domain/documents/documents";
import { suggestTaxCategoryForPropertyUsage } from "@/domain/properties/rental";
import { centsToEuroInputString, parseEuroInputToCents } from "@/domain/core/money";
import { DOCUMENT_TYPE_LABELS, DOCUMENT_TYPE_OPTIONS, TAX_CATEGORY_LABELS } from "./labels";
import { DatePicker } from "@/frontend/ui/date-picker";

interface DocumentEditModalProps {
  doc: DocumentRow;
  properties: PropertyRow[];
  contracts: FinancialContractRow[];
  onClose: () => void;
  onSaved: () => void;
}

export function DocumentEditModal({
  doc,
  properties,
  contracts,
  onClose,
  onSaved,
}: DocumentEditModalProps) {
  const [documentType, setDocumentType] = React.useState<DocumentType>(
    doc.documentType,
  );
  const [documentDate, setDocumentDate] = React.useState(
    doc.documentDate ?? "",
  );
  const [issuer, setIssuer] = React.useState(doc.issuer ?? "");
  const [totalAmountInput, setTotalAmountInput] = React.useState(
    doc.totalAmountCents != null
      ? centsToEuroInputString(doc.totalAmountCents)
      : "",
  );
  const [linkedPropertyId, setLinkedPropertyId] = React.useState(
    doc.linkedPropertyId ?? "",
  );
  const [linkedContractId, setLinkedContractId] = React.useState(
    doc.linkedContractId ?? "",
  );
  const [isTaxRelevant, setIsTaxRelevant] = React.useState(doc.isTaxRelevant);
  const [taxYearInput, setTaxYearInput] = React.useState(
    doc.taxYear != null ? String(doc.taxYear) : "",
  );
  const [hasExplicitTaxCategory, setHasExplicitTaxCategory] = React.useState(
    Boolean(doc.taxCategory),
  );
  const [taxCategory, setTaxCategory] = React.useState<TaxCategory>(() => {
    if (doc.taxCategory) return doc.taxCategory;
    const initialProp = properties.find((p) => p.id === doc.linkedPropertyId);
    const suggested = initialProp
      ? suggestTaxCategoryForPropertyUsage(initialProp.usage)
      : null;
    return suggested ?? "handwerker_35a";
  });
  const [deductibleInput, setDeductibleInput] = React.useState(
    doc.deductibleAmountCents != null
      ? centsToEuroInputString(doc.deductibleAmountCents)
      : "",
  );
  const [isSaving, setIsSaving] = React.useState(false);
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrorMessage(null);

    const totalAmountCents = totalAmountInput.trim()
      ? parseEuroInputToCents(totalAmountInput)
      : null;
    if (
      totalAmountInput.trim() &&
      (totalAmountCents === null || totalAmountCents < 0)
    ) {
      setErrorMessage("Ungültiger Gesamtbetrag.");
      return;
    }

    const deductibleAmountCents =
      isTaxRelevant && deductibleInput.trim()
        ? parseEuroInputToCents(deductibleInput)
        : null;
    if (
      isTaxRelevant &&
      deductibleInput.trim() &&
      (deductibleAmountCents === null || deductibleAmountCents < 0)
    ) {
      setErrorMessage("Ungültiger absetzbarer Betrag.");
      return;
    }

    if (
      totalAmountCents !== null &&
      deductibleAmountCents !== null &&
      deductibleAmountCents > totalAmountCents
    ) {
      setErrorMessage(
        "Der absetzbare Betrag darf den Gesamtbetrag nicht übersteigen.",
      );
      return;
    }

    const taxYear =
      isTaxRelevant && taxYearInput.trim() ? Number(taxYearInput.trim()) : null;
    if (
      isTaxRelevant &&
      taxYearInput.trim() &&
      (!Number.isInteger(taxYear) ||
        (taxYear as number) < 1900 ||
        (taxYear as number) > 2100)
    ) {
      setErrorMessage("Bitte ein gültiges Steuerjahr (1900–2100) eingeben.");
      return;
    }

    setIsSaving(true);
    try {
      const response = await fetch(`/api/documents/${doc.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          documentType,
          documentDate: documentDate.trim() || null,
          issuer: issuer.trim() || null,
          totalAmountCents,
          linkedPropertyId: linkedPropertyId || null,
          linkedContractId: linkedContractId || null,
          isTaxRelevant,
          taxYear,
          taxCategory: isTaxRelevant ? taxCategory : null,
          deductibleAmountCents,
        }),
      });

      const body = (await response.json()) as {
        error?: string;
        fieldErrors?: Record<string, string>;
      };
      if (!response.ok) {
        const fieldMsgs = body.fieldErrors
          ? Object.values(body.fieldErrors).filter(Boolean)
          : [];
        setErrorMessage(
          fieldMsgs.length > 0
            ? fieldMsgs.join(" ")
            : (body.error ?? "Speichern fehlgeschlagen."),
        );
        setIsSaving(false);
        return;
      }

      onSaved();
    } catch {
      setErrorMessage("Netzwerkfehler beim Speichern.");
      setIsSaving(false);
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title="Beleg-Metadaten bearbeiten"
      description={doc.filename}
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {errorMessage ? (
          <div className="rounded-lg border border-[var(--rose)]/40 bg-[var(--rose)]/10 px-3 py-2 text-xs text-[var(--rose)]">
            {errorMessage}
          </div>
        ) : null}

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="edit-doc-type">Dokumenttyp</Label>
            <Select
              id="edit-doc-type"
              value={documentType}
              onChange={(e) => setDocumentType(e.target.value as DocumentType)}
            >
              {DOCUMENT_TYPE_OPTIONS.map((t) => (
                <option key={t} value={t}>
                  {DOCUMENT_TYPE_LABELS[t]}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="edit-doc-date">Belegdatum</Label>
            <DatePicker
              id="edit-doc-date"
              value={documentDate}
              onChange={setDocumentDate}
            />
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="edit-doc-issuer">Aussteller</Label>
            <Input
              id="edit-doc-issuer"
              value={issuer}
              onChange={(e) => setIssuer(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="edit-doc-total">Gesamtbetrag (€)</Label>
            <Input
              id="edit-doc-total"
              className="tabular-nums"
              value={totalAmountInput}
              onChange={(e) => setTotalAmountInput(e.target.value)}
            />
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="edit-doc-prop">Immobilie</Label>
            <Select
              id="edit-doc-prop"
              value={linkedPropertyId}
              onChange={(e) => {
                const nextProp = e.target.value;
                setLinkedPropertyId(nextProp);
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
              <option value="">Keine</option>
              {properties.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="edit-doc-contract">Vertrag</Label>
            <Select
              id="edit-doc-contract"
              value={linkedContractId}
              onChange={(e) => setLinkedContractId(e.target.value)}
            >
              <option value="">Keiner</option>
              {contracts.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </div>
        </div>

        <label className="flex cursor-pointer items-center gap-2 text-sm font-medium text-[var(--text-primary)]">
          <input
            type="checkbox"
            checked={isTaxRelevant}
            onChange={(e) => {
              const checked = e.target.checked;
              setIsTaxRelevant(checked);
              if (checked && !hasExplicitTaxCategory) {
                const prop = properties.find((p) => p.id === linkedPropertyId);
                const suggested = prop
                  ? suggestTaxCategoryForPropertyUsage(prop.usage)
                  : null;
                if (suggested) {
                  setTaxCategory(suggested);
                }
              }
            }}
            className="h-4 w-4 rounded accent-[var(--accent)]"
          />
          <span>Steuerrelevant</span>
        </label>

        {isTaxRelevant ? (
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1">
              <Label htmlFor="edit-doc-tax-year">Steuerjahr</Label>
              <Input
                id="edit-doc-tax-year"
                type="number"
                className="tabular-nums"
                value={taxYearInput}
                onChange={(e) => setTaxYearInput(e.target.value)}
              />
            </div>
            <div className="space-y-1 sm:col-span-2">
              <Label htmlFor="edit-doc-tax-cat">Kategorie</Label>
              <Select
                id="edit-doc-tax-cat"
                value={taxCategory}
                onChange={(e) => {
                  setHasExplicitTaxCategory(true);
                  setTaxCategory(e.target.value as TaxCategory);
                }}
              >
                {TAX_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {TAX_CATEGORY_LABELS[c]}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-1 sm:col-span-3">
              <Label htmlFor="edit-doc-deductible">
                Absetzbarer Betrag (€)
              </Label>
              <Input
                id="edit-doc-deductible"
                className="tabular-nums"
                value={deductibleInput}
                onChange={(e) => setDeductibleInput(e.target.value)}
              />
            </div>
          </div>
        ) : null}

        <div className="flex justify-end gap-2 border-t border-[var(--border)] pt-3">
          <Button type="button" variant="outline" onClick={onClose}>
            Abbrechen
          </Button>
          <Button type="submit" variant="default" disabled={isSaving}>
            {isSaving ? "Speichert..." : "Speichern"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
