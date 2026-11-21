"use client";

import { formatDateDE } from "@/domain/core/date-format";
import Link from "next/link";
import { Pencil, Trash2 } from "lucide-react";
import { StatusBadge } from "@/frontend/ui/status-badge";
import { Badge } from "@/frontend/ui/badge";
import { Button } from "@/frontend/ui/button";
import { Sheet } from "@/frontend/ui/sheet";
import { formatBpsDE, formatCentsDE } from "@/domain/core/money";
import { PROPERTY_USAGE_LABELS } from "./labels";
import { LinkedDocumentsSection } from "./linked-documents-section";
import { PropertyValuationCard } from "./property-valuation/valuation-card";
import {
  PropertyDetailDrawerProps, type PropertyDetailInnerProps, usePropertyDetail,
} from "./property-detail/use-property-detail";
import { PropertyImageSection } from "./property-detail/image-section";
import { PropertyMetadataSection } from "./property-detail/metadata-section";
import { PropertyRentalMetricsSection } from "./property-detail/rental-section";
import { PropertyLinkedContractsSection } from "./property-detail/linked-contracts-section";

export function PropertyDetailDrawer(props: PropertyDetailDrawerProps) {
  if (!props.property || !props.summary) {
    return null;
  }

  return (
    <PropertyDetailDrawerInner
      key={props.property.id}
      {...props}
      property={props.property}
      summary={props.summary}
    />
  );
}

function PropertyDetailDrawerInner(props: PropertyDetailInnerProps) {
  const ws = usePropertyDetail(props);
  const {
    asOfDate, confirmDelete, errorMessage, handleDelete, isBusy, isDeleting,
    isPurchasePriceCalibrated, linkedDocuments, loanDraft, maintenancePot, onClose,
    onCreateLoanFromDraft, onDiscardLoanDraft, onEdit, onMutated, property, setConfirmDelete,
    showDebug, summary,
  } = ws;
  return (
    <Sheet
      open={Boolean(property)}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={property.name}
      subtitle={
        <>
          {PROPERTY_USAGE_LABELS[property.usage]} · Stand{" "}
          <span className="tabular-nums">{formatDateDE(asOfDate)}</span>
        </>
      }
    >
      <div className="space-y-6">
        {errorMessage ? (
          <div className="rounded-lg border border-[var(--rose)]/40 bg-[var(--rose)]/10 px-3 py-2 text-xs text-[var(--rose)]">
            {errorMessage}
          </div>
        ) : null}

        <PropertyImageSection ws={ws} />

        {/* Kennzahlen */}
        <div className="flex flex-wrap items-center gap-2">
          <Badge>{PROPERTY_USAGE_LABELS[property.usage]}</Badge>
          {isPurchasePriceCalibrated ? (
            <StatusBadge variant="calibrated" detail="Kaufpreis" />
          ) : (
            <StatusBadge variant="modeled" detail="Schätzwert" />
          )}
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div
            className={
              isPurchasePriceCalibrated
                ? "rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)]/40 p-4"
                : "rounded-xl border border-dashed border-[var(--border-sub)] bg-[var(--surface-elevated)]/40 p-4"
            }
          >
            <p className="text-xs text-[var(--text-secondary)]">
              Geschätzter Immobilienwert
            </p>
            <p className="mt-1 tabular-nums text-xl font-semibold text-[var(--sky)]">
              {formatCentsDE(summary.estimatedValueCents)}
            </p>
            <p className="mt-1 tabular-nums text-xs text-[var(--text-secondary)]">
              {property.estimatedValueAsOf
                ? `Stand ${formatDateDE(property.estimatedValueAsOf)}`
                : "Stand unbekannt"}
            </p>
          </div>

          <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)]/40 p-4">
            <p className="text-xs text-[var(--text-secondary)]">
              Netto-Immobilienwert (Eigenkapital)
            </p>
            <p
              className={`mt-1 tabular-nums text-xl font-semibold ${
                summary.netEquityCents >= 0
                  ? "text-[var(--emerald)]"
                  : "text-[var(--rose)]"
              }`}
            >
              {formatCentsDE(summary.netEquityCents)}
            </p>
          </div>
        </div>

        <div className="space-y-2 rounded-xl border border-[var(--border)] p-4 text-sm">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[var(--text-secondary)]">Kaufdatum</span>
            <span className="tabular-nums font-medium text-[var(--text-primary)]">
              {property.purchaseDate ?? "–"}
            </span>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-[var(--text-secondary)]">Kaufpreis</span>
            <span className="tabular-nums font-medium text-[var(--text-primary)]">
              {property.purchasePriceCents != null
                ? formatCentsDE(property.purchasePriceCents)
                : "–"}
            </span>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-[var(--text-secondary)]">
              Verknüpfte Restschulden
            </span>
            <span className="tabular-nums font-medium text-[var(--rose)]">
              {formatCentsDE(summary.linkedLoanBalanceCents)}
            </span>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-[var(--text-secondary)]">
              Verknüpftes Bauspar-Guthaben
            </span>
            <span className="tabular-nums font-medium text-[var(--sky)]">
              {formatCentsDE(summary.linkedSavingsBalanceCents)}
            </span>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-[var(--text-secondary)]">
              Beleihungsauslauf (LTV)
            </span>
            <span className="tabular-nums font-medium text-[var(--text-primary)]">
              {summary.ltvBps != null ? formatBpsDE(summary.ltvBps) : "–"}
            </span>
          </div>
        </div>

        <PropertyValuationCard
          key={property.id}
          property={property}
          showDebug={showDebug}
          onMutated={onMutated}
        />

        <PropertyMetadataSection ws={ws} />

        <PropertyRentalMetricsSection ws={ws} />

        {/* Rücklage und Kreditentwurf */}

        {maintenancePot ? (
          <div className="flex items-center justify-between gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface)]  p-3.5 text-sm">
            <div>
              <p className="text-xs text-[var(--text-secondary)]">
                Instandhaltungs-Topf
              </p>
              <p className="font-medium text-[var(--text-primary)]">
                {maintenancePot.name}
              </p>
              <p className="tabular-nums text-xs text-[var(--text-secondary)]">
                Stand: {formatCentsDE(maintenancePot.currentCents)}
                {maintenancePot.targetCents != null
                  ? ` / Ziel: ${formatCentsDE(maintenancePot.targetCents)}`
                  : ""}
              </p>
            </div>
            <Link
              href="/allokation"
              className="shrink-0 text-xs font-medium text-[var(--accent)] hover:underline"
            >
              Zur Allokation
            </Link>
          </div>
        ) : null}

        {loanDraft && loanDraft.loanAmountCents > 0 ? (
          <div className="space-y-3 rounded-xl border border-dashed border-[var(--border-sub)] bg-[var(--surface-elevated)]/40 p-4">
            <div className="flex items-center justify-between gap-2">
              <p className="section-label text-[var(--text-secondary)]">
                Objektkredit anlegen (Entwurf)
              </p>
              <StatusBadge variant="modeled" />
            </div>
            <p className="tabular-nums text-xs text-[var(--text-secondary)]">
              Darlehen {formatCentsDE(loanDraft.loanAmountCents)} · Rate{" "}
              {formatCentsDE(loanDraft.monthlyRateCents)}/Monat · Zins{" "}
              {formatBpsDE(loanDraft.interestRateBps)}
            </p>
            <div className="flex flex-wrap gap-2">
              {onCreateLoanFromDraft ? (
                <Button
                  type="button"
                  size="sm"
                  onClick={onCreateLoanFromDraft}
                  disabled={isBusy}
                >
                  Objektkredit anlegen
                </Button>
              ) : null}
              {onDiscardLoanDraft ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={onDiscardLoanDraft}
                  disabled={isBusy}
                >
                  Verwerfen
                </Button>
              ) : null}
            </div>
          </div>
        ) : null}

        <PropertyLinkedContractsSection ws={ws} />

        <LinkedDocumentsSection
          documents={linkedDocuments}
          showTaxTags={property.usage === "rented"}
          emptyText="Noch keine verifizierten Belege verknüpft. Kaufverträge, Gutachten und Handwerkerrechnungen können über die Dokumenten-Inbox zugeordnet werden."
        />

        <div className="space-y-3 border-t border-[var(--border)] pt-4">
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => onEdit(property)}
              disabled={isBusy}
            >
              <Pencil className="h-3.5 w-3.5" />
              Bearbeiten
            </Button>

            {!confirmDelete ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setConfirmDelete(true)}
                disabled={isBusy}
                className="text-[var(--rose)] hover:border-[var(--rose)]/50"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Löschen
              </Button>
            ) : null}
          </div>

          {confirmDelete ? (
            <div className="space-y-2 rounded-xl border border-[var(--rose)]/40 bg-[var(--rose)]/10 p-3">
              <p className="text-xs text-[var(--text-primary)]">
                Immobilie wirklich löschen? Verknüpfte Verträge bleiben erhalten;
                nur die Zuordnung zu dieser Immobilie wird gelöst.
              </p>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  onClick={handleDelete}
                  disabled={isDeleting}
                  variant="destructive"
                >
                  {isDeleting ? "Löscht..." : "Endgültig löschen"}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setConfirmDelete(false)}
                  disabled={isDeleting}
                >
                  Abbrechen
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </Sheet>
  );
}
