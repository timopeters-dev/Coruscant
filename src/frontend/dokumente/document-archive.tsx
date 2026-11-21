"use client";

import { formatDateDE } from "@/domain/core/date-format";
import Link from "next/link";
import * as React from "react";
import { ArrowRight, ExternalLink, FileCheck2, Pencil, Trash2 } from "lucide-react";
import { StatusBadge } from "@/frontend/ui/status-badge";
import { Badge } from "@/frontend/ui/badge";
import { Button } from "@/frontend/ui/button";
import { Card, CardContent } from "@/frontend/ui/card";
import { Label } from "@/frontend/ui/label";
import { Select } from "@/frontend/ui/select";
import type { FinancialContractRow } from "@/backend/db/queries/contracts";
import type { PropertyRow } from "@/backend/db/queries/properties";
import type { DocumentRow } from "@/backend/db/queries/documents";
import { filterVerifiedDocuments, resolveDocumentTaxYear } from "@/domain/documents/documents";
import { listTaxYears } from "@/domain/tax/summary";
import { formatCentsDE } from "@/domain/core/money";
import { DOCUMENT_TYPE_LABELS, TAX_CATEGORY_LABELS } from "./labels";
import { DocumentEditModal } from "./document-edit-modal";

interface DocumentArchiveProps {
  verifiedDocuments: DocumentRow[];
  properties: PropertyRow[];
  contracts: FinancialContractRow[];
  onMutated: () => void;
}

export function DocumentArchive({
  verifiedDocuments,
  properties,
  contracts,
  onMutated,
}: DocumentArchiveProps) {
  const [taxYearFilter, setTaxYearFilter] = React.useState<string>("all");
  const [entityFilter, setEntityFilter] = React.useState<string>("all");
  const [onlyTaxRelevant, setOnlyTaxRelevant] = React.useState<boolean>(false);
  const [editingDoc, setEditingDoc] = React.useState<DocumentRow | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = React.useState<string | null>(
    null,
  );
  const [isDeleting, setIsDeleting] = React.useState(false);

  const propertyById = React.useMemo(() => {
    const map = new Map<string, PropertyRow>();
    for (const p of properties) map.set(p.id, p);
    return map;
  }, [properties]);

  const contractById = React.useMemo(() => {
    const map = new Map<string, FinancialContractRow>();
    for (const c of contracts) map.set(c.id, c);
    return map;
  }, [contracts]);

  const availableYears = React.useMemo(() => {
    const years = new Set<number>();
    for (const doc of verifiedDocuments) {
      const y = resolveDocumentTaxYear(doc);
      if (y !== null) years.add(y);
    }
    return Array.from(years).sort((a, b) => b - a);
  }, [verifiedDocuments]);

  const parsedTaxYear =
    taxYearFilter === "all" ? null : Number(taxYearFilter);

  const filteredDocs = React.useMemo(() => {
    const propertyId = entityFilter.startsWith("prop:")
      ? entityFilter.slice(5)
      : null;
    const contractId = entityFilter.startsWith("contract:")
      ? entityFilter.slice(9)
      : null;

    return filterVerifiedDocuments(verifiedDocuments, {
      taxYear: parsedTaxYear,
      propertyId,
      contractId,
      onlyTaxRelevant,
    });
  }, [verifiedDocuments, parsedTaxYear, entityFilter, onlyTaxRelevant]);

  const taxOverviewYear = React.useMemo(() => {
    const years = listTaxYears(verifiedDocuments);
    if (years.length === 0) return null;
    return parsedTaxYear !== null && years.includes(parsedTaxYear)
      ? parsedTaxYear
      : years[0];
  }, [verifiedDocuments, parsedTaxYear]);

  async function handleDelete(id: string) {
    setIsDeleting(true);
    try {
      const response = await fetch(`/api/documents/${id}`, {
        method: "DELETE",
      });
      if (response.ok) {
        setConfirmDeleteId(null);
        onMutated();
      }
    } finally {
      setIsDeleting(false);
    }
  }

  return (
    <div className="space-y-4">
      {/* Filter bar */}
      <div className="flex flex-wrap items-end justify-between gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface)]  p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-36 space-y-1">
            <Label htmlFor="archive-year-filter">Steuerjahr</Label>
            <Select
              id="archive-year-filter"
              value={taxYearFilter}
              onChange={(e) => setTaxYearFilter(e.target.value)}
            >
              <option value="all">Alle Jahre</option>
              {availableYears.map((y) => (
                <option key={y} value={String(y)}>
                  {y}
                </option>
              ))}
            </Select>
          </div>

          <div className="w-60 space-y-1">
            <Label htmlFor="archive-entity-filter">Objekt / Vertrag</Label>
            <Select
              id="archive-entity-filter"
              value={entityFilter}
              onChange={(e) => setEntityFilter(e.target.value)}
            >
              <option value="all">Alle Objekte &amp; Verträge</option>
              {properties.map((p) => (
                <option key={p.id} value={`prop:${p.id}`}>
                  Immobilie: {p.name}
                </option>
              ))}
              {contracts.map((c) => (
                <option key={c.id} value={`contract:${c.id}`}>
                  Vertrag: {c.name}
                </option>
              ))}
            </Select>
          </div>

          <label className="flex h-9 cursor-pointer items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface-elevated)]/50 px-3 text-xs font-medium text-[var(--text-primary)]">
            <input
              type="checkbox"
              checked={onlyTaxRelevant}
              onChange={(e) => setOnlyTaxRelevant(e.target.checked)}
              className="h-3.5 w-3.5 rounded accent-[var(--accent)]"
            />
            <span>Nur steuerrelevant</span>
          </label>
        </div>

        <span className="tabular-nums text-xs text-[var(--text-secondary)]">
          {filteredDocs.length} von {verifiedDocuments.length} verifizierten
          Belegen
        </span>
      </div>

      {/* Link zur Steuer-Übersicht (eine Wahrheit statt zwei Aggregationen) */}
      {taxOverviewYear !== null ? (
        <Link
          href={`/dokumente/steuer?jahr=${taxOverviewYear}`}
          className="flex items-center justify-between rounded-xl border border-[var(--border)] bg-[var(--surface)]  px-4 py-3 text-sm font-medium text-[var(--text-primary)] transition-colors hover:bg-[var(--surface-elevated)]"
        >
          <span>
            Steuer-Übersicht{" "}
            <span className="tabular-nums">{taxOverviewYear}</span> öffnen
          </span>
          <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </Link>
      ) : null}

      {/* Archive list */}
      {filteredDocs.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-10 text-center">
            <FileCheck2
              className="mb-2 h-8 w-8 text-[var(--text-secondary)]"
              aria-hidden="true"
            />
            <p className="text-sm font-medium text-[var(--text-primary)]">
              Keine verifizierten Belege im aktuellen Filter
            </p>
            <p className="mt-1 text-xs text-[var(--text-secondary)]">
              Freigegebene Dokumente erscheinen hier und lassen sich nach
              Steuerjahr oder Objekt filtern.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2.5">
          {filteredDocs.map((doc) => {
            const linkedProp = doc.linkedPropertyId
              ? propertyById.get(doc.linkedPropertyId)
              : null;
            const linkedContract = doc.linkedContractId
              ? contractById.get(doc.linkedContractId)
              : null;

            return (
              <Card key={doc.id} className="p-4">
                <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate text-sm font-medium text-[var(--text-primary)]">
                        {doc.issuer ? `${doc.issuer} – ${doc.filename}` : doc.filename}
                      </span>
                      <StatusBadge variant="calibrated" detail="Verifiziert" />
                      <Badge variant="outline">
                        {DOCUMENT_TYPE_LABELS[doc.documentType]}
                      </Badge>
                      {doc.isTaxRelevant && doc.taxCategory ? (
                        <Badge>
                          {TAX_CATEGORY_LABELS[doc.taxCategory]}
                          {doc.taxYear ? ` · ${doc.taxYear}` : ""}
                        </Badge>
                      ) : null}
                    </div>

                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[var(--text-secondary)]">
                      <span className="tabular-nums">
                        Datum: {doc.documentDate ? formatDateDE(doc.documentDate) : "–"}
                      </span>
                      {linkedProp ? (
                        <span>Immobilie: {linkedProp.name}</span>
                      ) : null}
                      {linkedContract ? (
                        <span>Vertrag: {linkedContract.name}</span>
                      ) : null}
                      {doc.detectedBalanceCents != null ? (
                        <span className="tabular-nums">
                          Stand: {formatCentsDE(doc.detectedBalanceCents)}
                        </span>
                      ) : null}
                    </div>
                  </div>

                  <div className="flex shrink-0 flex-wrap items-center gap-3">
                    <div className="text-right">
                      {doc.totalAmountCents != null ? (
                        <p className="tabular-nums text-sm font-semibold text-[var(--text-primary)]">
                          {formatCentsDE(doc.totalAmountCents)}
                        </p>
                      ) : null}
                      {doc.isTaxRelevant && doc.deductibleAmountCents != null ? (
                        <p className="tabular-nums text-xs text-[var(--emerald)]">
                          Absetzbar: {formatCentsDE(doc.deductibleAmountCents)}
                        </p>
                      ) : null}
                    </div>

                    <div className="flex items-center gap-1.5">
                      <a
                        href={`/api/documents/${doc.id}/file`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex h-8 items-center gap-1 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2.5 text-xs font-medium text-[var(--text-primary)] transition-colors hover:bg-[var(--surface-elevated)]"
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                        PDF
                      </a>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setEditingDoc(doc)}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                        Bearbeiten
                      </Button>

                      {confirmDeleteId !== doc.id ? (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => setConfirmDeleteId(doc.id)}
                          className="text-[var(--rose)] hover:border-[var(--rose)]/50"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      ) : (
                        <div className="flex items-center gap-1">
                          <Button
                            type="button"
                            size="sm"
                            disabled={isDeleting}
                            onClick={() => void handleDelete(doc.id)}
                            variant="destructive"
                          >
                            Löschen?
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={isDeleting}
                            onClick={() => setConfirmDeleteId(null)}
                          >
                            Nein
                          </Button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {editingDoc ? (
        <DocumentEditModal
          key={editingDoc.id}
          doc={editingDoc}
          properties={properties}
          contracts={contracts}
          onClose={() => setEditingDoc(null)}
          onSaved={() => {
            setEditingDoc(null);
            onMutated();
          }}
        />
      ) : null}
    </div>
  );
}
