"use client";

import * as React from "react";
import { Building2, FileText, Pencil, Trash2 } from "lucide-react";
import { StatusBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import type { FinancialContractRow, PropertyRow } from "@/db/queries/contracts";
import type { ContractProjectionResult } from "@/lib/domain/contracts";
import { formatBpsDE, formatCentsDE } from "@/lib/domain/money";
import type { PropertySummary } from "@/lib/domain/properties";
import { getContractTypeLabel, PROPERTY_USAGE_LABELS } from "./labels";

interface PropertyDetailDrawerProps {
  property: PropertyRow | null;
  summary: PropertySummary | null;
  linkedContracts: FinancialContractRow[];
  projectionsById: Record<string, ContractProjectionResult>;
  asOfDate: string;
  onClose: () => void;
  onEdit: (property: PropertyRow) => void;
  onSelectContract: (contract: FinancialContractRow) => void;
  onDeleted: () => void;
}

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

function PropertyDetailDrawerInner({
  property,
  summary,
  linkedContracts,
  projectionsById,
  asOfDate,
  onClose,
  onEdit,
  onSelectContract,
  onDeleted,
}: Omit<PropertyDetailDrawerProps, "property" | "summary"> & {
  property: PropertyRow;
  summary: PropertySummary;
}) {
  const [confirmDelete, setConfirmDelete] = React.useState(false);
  const [isDeleting, setIsDeleting] = React.useState(false);
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);

  const isPurchasePriceCalibrated =
    property.purchasePriceCents != null &&
    property.estimatedValueCents === property.purchasePriceCents;

  async function handleDelete() {
    if (!property) return;
    setIsDeleting(true);
    setErrorMessage(null);

    try {
      const response = await fetch(`/api/properties/${property.id}`, {
        method: "DELETE",
      });
      if (!response.ok) {
        const body = (await response.json()) as { error?: string };
        setErrorMessage(body.error ?? "Löschen fehlgeschlagen.");
        setIsDeleting(false);
        return;
      }

      onClose();
      onDeleted();
    } catch {
      setErrorMessage("Netzwerkfehler beim Löschen der Immobilie.");
      setIsDeleting(false);
    }
  }

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
          <span className="tabular-nums">{asOfDate}</span>
        </>
      }
    >
      <div className="space-y-6">
        {errorMessage ? (
          <div className="rounded-lg border border-[var(--rose)]/40 bg-[var(--rose)]/10 px-3 py-2 text-xs text-[var(--rose)]">
            {errorMessage}
          </div>
        ) : null}

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

        <div className="space-y-2.5">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-[var(--text-secondary)]">
            <Building2 className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Verknüpfte Verträge ({linkedContracts.length})</span>
          </div>

          {linkedContracts.length === 0 ? (
            <p className="rounded-xl border border-dashed border-[var(--border-sub)] p-4 text-xs text-[var(--text-secondary)]">
              Dieser Immobilie sind noch keine Kredite oder Bausparverträge
              zugeordnet.
            </p>
          ) : (
            <div className="space-y-2">
              {linkedContracts.map((contract) => {
                const projection = projectionsById[contract.id];
                const balanceCents =
                  projection?.projectedBalanceCents ??
                  contract.currentBalanceCents;
                return (
                  <button
                    key={contract.id}
                    type="button"
                    onClick={() => onSelectContract(contract)}
                    className="flex w-full items-center justify-between gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3 text-left transition-colors hover:bg-[var(--surface-elevated)]"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-[var(--text-primary)]">
                        {contract.name}
                      </p>
                      <p className="text-xs text-[var(--text-secondary)]">
                        {getContractTypeLabel(
                          contract.category,
                          contract.repaymentType,
                        )}
                        {contract.status === "closed" ? " · Beendet" : ""}
                      </p>
                    </div>
                    <span
                      className={`shrink-0 tabular-nums text-sm font-semibold ${
                        contract.category === "loan"
                          ? "text-[var(--rose)]"
                          : "text-[var(--sky)]"
                      }`}
                    >
                      {formatCentsDE(balanceCents)}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="rounded-xl border border-dashed border-[var(--border-sub)] bg-[var(--surface-elevated)]/30 p-4">
          <div className="flex items-center gap-2 text-xs font-medium text-[var(--text-primary)]">
            <FileText className="h-3.5 w-3.5 text-[var(--amber)]" />
            <span>Verknüpfte Belege (ab Slice 6)</span>
          </div>
          <p className="mt-1 text-xs text-[var(--text-secondary)]">
            Kaufverträge, Gutachten und Handwerkerrechnungen werden ab Slice 6
            über die KI-Dokumenten-Inbox hier verknüpft.
          </p>
        </div>

        <div className="space-y-3 border-t border-[var(--border)] pt-4">
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => onEdit(property)}
              disabled={isDeleting}
            >
              <Pencil className="h-3.5 w-3.5" />
              Bearbeiten
            </Button>

            {!confirmDelete ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setConfirmDelete(true)}
                disabled={isDeleting}
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
                  className="bg-[var(--rose)] text-white hover:opacity-90"
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
