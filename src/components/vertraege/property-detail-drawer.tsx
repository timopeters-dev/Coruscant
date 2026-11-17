"use client";

import * as React from "react";
import {
  Building2,
  ImagePlus,
  Link2,
  Pencil,
  Trash2,
  Unlink,
} from "lucide-react";
import { StatusBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Sheet } from "@/components/ui/sheet";
import type { FinancialContractRow, PropertyRow } from "@/db/queries/contracts";
import type { DocumentRow } from "@/db/queries/documents";
import type { ContractProjectionResult } from "@/lib/domain/contracts";
import { formatBpsDE, formatCentsDE } from "@/lib/domain/money";
import type { PropertySummary } from "@/lib/domain/properties";
import { getContractTypeLabel, PROPERTY_USAGE_LABELS } from "./labels";
import { LinkedDocumentsSection } from "./linked-documents-section";

const MAX_CLIENT_IMAGE_BYTES = 5 * 1024 * 1024;

interface PropertyDetailDrawerProps {
  property: PropertyRow | null;
  summary: PropertySummary | null;
  linkedContracts: FinancialContractRow[];
  unlinkedContracts: FinancialContractRow[];
  linkedDocuments: DocumentRow[];
  projectionsById: Record<string, ContractProjectionResult>;
  asOfDate: string;
  onClose: () => void;
  onEdit: (property: PropertyRow) => void;
  onSelectContract: (contract: FinancialContractRow) => void;
  onMutated: () => void;
}

function formatPropertyAddress(property: PropertyRow): string | null {
  const streetPart = [property.street, property.houseNumber]
    .filter(Boolean)
    .join(" ");
  const cityPart = [property.postalCode, property.city]
    .filter(Boolean)
    .join(" ");
  const parts = [streetPart, cityPart].filter(Boolean);
  return parts.length > 0 ? parts.join(", ") : null;
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
  unlinkedContracts,
  linkedDocuments,
  projectionsById,
  asOfDate,
  onClose,
  onEdit,
  onSelectContract,
  onMutated,
}: Omit<PropertyDetailDrawerProps, "property" | "summary"> & {
  property: PropertyRow;
  summary: PropertySummary;
}) {
  const fileInputRef = React.useRef<HTMLInputElement | null>(null);

  const [confirmDelete, setConfirmDelete] = React.useState(false);
  const [isDeleting, setIsDeleting] = React.useState(false);
  const [isUploadingImage, setIsUploadingImage] = React.useState(false);
  const [isRemovingImage, setIsRemovingImage] = React.useState(false);
  const [imageError, setImageError] = React.useState<string | null>(null);
  const [selectedContractToLink, setSelectedContractToLink] =
    React.useState("");
  const [mutatingContractId, setMutatingContractId] = React.useState<
    string | null
  >(null);
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);

  const isPurchasePriceCalibrated =
    property.purchasePriceCents != null &&
    property.estimatedValueCents === property.purchasePriceCents;

  const formattedAddress = formatPropertyAddress(property);
  const hasMetadata =
    Boolean(formattedAddress) ||
    property.livingAreaSqm != null ||
    property.usableAreaSqm != null ||
    property.plotAreaSqm != null ||
    property.constructionYear != null ||
    property.energyClass != null ||
    Boolean(property.features);

  const isBusy =
    isDeleting ||
    isUploadingImage ||
    isRemovingImage ||
    mutatingContractId !== null;

  async function handleImageFileSelected(
    event: React.ChangeEvent<HTMLInputElement>,
  ) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    setImageError(null);
    if (file.size > MAX_CLIENT_IMAGE_BYTES) {
      setImageError("Die ausgewählte Datei ist größer als 5 MB.");
      return;
    }

    setIsUploadingImage(true);
    try {
      const formData = new FormData();
      formData.append("file", file);

      const response = await fetch(`/api/properties/${property.id}/image`, {
        method: "POST",
        body: formData,
      });

      const body = (await response.json()) as { error?: string };
      if (!response.ok) {
        setImageError(body.error ?? "Bildupload fehlgeschlagen.");
        setIsUploadingImage(false);
        return;
      }

      setIsUploadingImage(false);
      onMutated();
    } catch {
      setImageError("Netzwerkfehler beim Hochladen des Objektbildes.");
      setIsUploadingImage(false);
    }
  }

  async function handleRemoveImage() {
    setImageError(null);
    setIsRemovingImage(true);
    try {
      const response = await fetch(`/api/properties/${property.id}/image`, {
        method: "DELETE",
      });
      if (!response.ok) {
        const body = (await response.json()) as { error?: string };
        setImageError(body.error ?? "Bild konnte nicht entfernt werden.");
        setIsRemovingImage(false);
        return;
      }

      setIsRemovingImage(false);
      onMutated();
    } catch {
      setImageError("Netzwerkfehler beim Entfernen des Objektbildes.");
      setIsRemovingImage(false);
    }
  }

  async function handleLinkContract() {
    if (!selectedContractToLink) return;
    setErrorMessage(null);
    setMutatingContractId(selectedContractToLink);

    try {
      const response = await fetch(`/api/contracts/${selectedContractToLink}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ linkedPropertyId: property.id }),
      });

      if (!response.ok) {
        const body = (await response.json()) as { error?: string };
        setErrorMessage(body.error ?? "Vertrag konnte nicht verknüpft werden.");
        setMutatingContractId(null);
        return;
      }

      setSelectedContractToLink("");
      setMutatingContractId(null);
      onMutated();
    } catch {
      setErrorMessage("Netzwerkfehler beim Verknüpfen des Vertrags.");
      setMutatingContractId(null);
    }
  }

  async function handleUnlinkContract(contractId: string) {
    setErrorMessage(null);
    setMutatingContractId(contractId);

    try {
      const response = await fetch(`/api/contracts/${contractId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ linkedPropertyId: null }),
      });

      if (!response.ok) {
        const body = (await response.json()) as { error?: string };
        setErrorMessage(
          body.error ?? "Verknüpfung konnte nicht gelöst werden.",
        );
        setMutatingContractId(null);
        return;
      }

      setMutatingContractId(null);
      onMutated();
    } catch {
      setErrorMessage("Netzwerkfehler beim Lösen der Verknüpfung.");
      setMutatingContractId(null);
    }
  }

  async function handleDelete() {
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
      onMutated();
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

        {/* Objektbild */}
        <div className="space-y-2">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            onChange={handleImageFileSelected}
            className="hidden"
          />

          {property.imagePath ? (
            <div className="space-y-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`/api/properties/${property.id}/image?v=${encodeURIComponent(property.updatedAt)}`}
                alt={`Objektbild: ${property.name}`}
                className="max-h-48 w-full rounded-xl border border-[var(--border)] object-cover"
              />
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isBusy}
                >
                  <ImagePlus className="h-3.5 w-3.5" />
                  {isUploadingImage ? "Lädt hoch..." : "Bild ersetzen"}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={handleRemoveImage}
                  disabled={isBusy}
                  className="text-[var(--rose)] hover:text-[var(--rose)]"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  {isRemovingImage ? "Entfernt..." : "Bild entfernen"}
                </Button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={isBusy}
              className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-[var(--border-sub)] bg-[var(--surface-elevated)]/30 px-4 py-3 text-xs text-[var(--text-secondary)] transition-colors hover:border-[var(--accent)] hover:text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-50"
            >
              <ImagePlus className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span>
                {isUploadingImage
                  ? "Bild wird hochgeladen..."
                  : "Objektbild hinzufügen (JPEG, PNG, WebP · max. 5 MB)"}
              </span>
            </button>
          )}

          {imageError ? (
            <p className="text-xs text-[var(--rose)]">{imageError}</p>
          ) : null}
        </div>

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

        {/* Stammdaten-Block */}
        {hasMetadata ? (
          <div className="space-y-2 rounded-xl border border-[var(--border)] p-4 text-sm">
            <p className="text-xs font-semibold uppercase tracking-wide text-[var(--text-secondary)]">
              Objektdaten
            </p>

            {formattedAddress ? (
              <div className="flex items-start justify-between gap-3">
                <span
                  className="text-[var(--text-secondary)]"
                  title="Lokal gespeichert"
                >
                  Adresse (lokal)
                </span>
                <span className="text-right font-medium text-[var(--text-primary)]">
                  {formattedAddress}
                </span>
              </div>
            ) : null}

            {property.livingAreaSqm != null ? (
              <div className="flex items-center justify-between gap-2">
                <span className="text-[var(--text-secondary)]">Wohnfläche</span>
                <span className="tabular-nums font-medium text-[var(--text-primary)]">
                  {property.livingAreaSqm} m²
                </span>
              </div>
            ) : null}

            {property.usableAreaSqm != null ? (
              <div className="flex items-center justify-between gap-2">
                <span className="text-[var(--text-secondary)]">Nutzfläche</span>
                <span className="tabular-nums font-medium text-[var(--text-primary)]">
                  {property.usableAreaSqm} m²
                </span>
              </div>
            ) : null}

            {property.plotAreaSqm != null ? (
              <div className="flex items-center justify-between gap-2">
                <span className="text-[var(--text-secondary)]">
                  Grundstücksfläche
                </span>
                <span className="tabular-nums font-medium text-[var(--text-primary)]">
                  {property.plotAreaSqm} m²
                </span>
              </div>
            ) : null}

            {property.constructionYear != null ? (
              <div className="flex items-center justify-between gap-2">
                <span className="text-[var(--text-secondary)]">Baujahr</span>
                <span className="tabular-nums font-medium text-[var(--text-primary)]">
                  {property.constructionYear}
                </span>
              </div>
            ) : null}

            {property.energyClass != null ? (
              <div className="flex items-center justify-between gap-2">
                <span className="text-[var(--text-secondary)]">
                  Energieklasse
                </span>
                <Badge variant="secondary">{property.energyClass}</Badge>
              </div>
            ) : null}

            {property.features ? (
              <div className="space-y-1 border-t border-[var(--border)]/60 pt-2">
                <span className="text-xs text-[var(--text-secondary)]">
                  Besonderheiten
                </span>
                <p className="text-sm text-[var(--text-primary)]">
                  {property.features}
                </p>
              </div>
            ) : null}
          </div>
        ) : null}

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
                const isMutatingThis = mutatingContractId === contract.id;

                return (
                  <div
                    key={contract.id}
                    className="flex items-center justify-between gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-2 transition-colors hover:bg-[var(--surface-elevated)]"
                  >
                    <button
                      type="button"
                      onClick={() => onSelectContract(contract)}
                      className="flex min-w-0 flex-1 items-center justify-between gap-3 rounded-lg p-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
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

                    <button
                      type="button"
                      onClick={() => handleUnlinkContract(contract.id)}
                      disabled={isBusy}
                      title="Verknüpfung lösen"
                      aria-label={`Verknüpfung von ${contract.name} lösen`}
                      className="shrink-0 rounded-lg p-1.5 text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface)] hover:text-[var(--rose)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <Unlink
                        className={`h-3.5 w-3.5 ${isMutatingThis ? "animate-pulse" : ""}`}
                      />
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          {unlinkedContracts.length > 0 ? (
            <div className="flex flex-col gap-2 pt-1 sm:flex-row sm:items-center">
              <Select
                aria-label="Bestehenden Vertrag verknüpfen"
                value={selectedContractToLink}
                onChange={(e) => setSelectedContractToLink(e.target.value)}
                disabled={isBusy}
                className="flex-1"
              >
                <option value="">Bestehenden Vertrag verknüpfen…</option>
                {unlinkedContracts.map((contract) => {
                  const balanceCents =
                    projectionsById[contract.id]?.projectedBalanceCents ??
                    contract.currentBalanceCents;
                  return (
                    <option key={contract.id} value={contract.id}>
                      {contract.name} (
                      {getContractTypeLabel(
                        contract.category,
                        contract.repaymentType,
                      )}{" "}
                      · {formatCentsDE(balanceCents)})
                    </option>
                  );
                })}
              </Select>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleLinkContract}
                disabled={!selectedContractToLink || isBusy}
                className="shrink-0"
              >
                <Link2 className="h-3.5 w-3.5" />
                Verknüpfen
              </Button>
            </div>
          ) : null}
        </div>

        <LinkedDocumentsSection
          documents={linkedDocuments}
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
