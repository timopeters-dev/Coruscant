"use client";

import * as React from "react";
import type { FinancialContractRow } from "@/backend/db/queries/contracts";
import type { PropertyRow } from "@/backend/db/queries/properties";
import type { DocumentRow } from "@/backend/db/queries/documents";
import type { ContractProjectionResult } from "@/domain/contracts/contract";
import type { PropertySummary } from "@/domain/properties/properties";
import { parseRenovations } from "@/domain/properties/renovations";
import type { RentalMetrics } from "@/domain/properties/rental";
import type { PurchaseDraft } from "@/validation/property-draft";

export const MAX_CLIENT_IMAGE_BYTES = 5 * 1024 * 1024;

export interface MaintenancePotSummary {
  id: string;
  name: string;
  currentCents: number;
  targetCents: number | null;
}

export interface PropertyDetailDrawerProps {
  property: PropertyRow | null;
  summary: PropertySummary | null;
  rentalMetrics?: RentalMetrics | null;
  maintenancePot?: MaintenancePotSummary | null;
  loanDraft?: PurchaseDraft | null;
  onCreateLoanFromDraft?: () => void;
  onDiscardLoanDraft?: () => void;
  linkedContracts: FinancialContractRow[];
  unlinkedContracts: FinancialContractRow[];
  linkedDocuments: DocumentRow[];
  projectionsById: Record<string, ContractProjectionResult>;
  asOfDate: string;
  showDebug?: boolean;
  onClose: () => void;
  onEdit: (property: PropertyRow) => void;
  onSelectContract: (contract: FinancialContractRow) => void;
  onMutated: () => void;
}

export function formatPropertyAddress(property: PropertyRow): string | null {
  const streetPart = [property.street, property.houseNumber]
    .filter(Boolean)
    .join(" ");
  const cityPart = [property.postalCode, property.city]
    .filter(Boolean)
    .join(" ");
  const parts = [streetPart, cityPart].filter(Boolean);
  return parts.length > 0 ? parts.join(", ") : null;
}

export type PropertyDetailInnerProps = Omit<PropertyDetailDrawerProps, "property" | "summary"> & {
  property: PropertyRow;
  summary: PropertySummary;
};


/** Zustand, Ableitungen und Aktionen von PropertyDetailDrawerInner. */
export function usePropertyDetail({
  property,
  summary,
  rentalMetrics,
  maintenancePot,
  loanDraft,
  onCreateLoanFromDraft,
  onDiscardLoanDraft,
  linkedContracts,
  unlinkedContracts,
  linkedDocuments,
  projectionsById,
  asOfDate,
  showDebug = false,
  onClose,
  onEdit,
  onSelectContract,
  onMutated,
}: PropertyDetailInnerProps) {
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
  const parsedRenovations = React.useMemo(
    () => parseRenovations(property.renovations),
    [property.renovations],
  );
  const hasMetadata =
    Boolean(formattedAddress) ||
    property.livingAreaSqm != null ||
    property.usableAreaSqm != null ||
    property.plotAreaSqm != null ||
    property.constructionYear != null ||
    property.energyClass != null ||
    parsedRenovations.length > 0 ||
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

  return {
    asOfDate,
    confirmDelete,
    errorMessage,
    fileInputRef,
    formattedAddress,
    handleDelete,
    handleImageFileSelected,
    handleLinkContract,
    handleRemoveImage,
    handleUnlinkContract,
    hasMetadata,
    imageError,
    isBusy,
    isDeleting,
    isPurchasePriceCalibrated,
    isRemovingImage,
    isUploadingImage,
    linkedContracts,
    linkedDocuments,
    loanDraft,
    maintenancePot,
    mutatingContractId,
    onClose,
    onCreateLoanFromDraft,
    onDiscardLoanDraft,
    onEdit,
    onMutated,
    onSelectContract,
    parsedRenovations,
    projectionsById,
    property,
    rentalMetrics,
    selectedContractToLink,
    setConfirmDelete,
    setErrorMessage,
    setImageError,
    setIsDeleting,
    setIsRemovingImage,
    setIsUploadingImage,
    setMutatingContractId,
    setSelectedContractToLink,
    showDebug,
    summary,
    unlinkedContracts,
  };
}

export type PropertyDetailState = ReturnType<typeof usePropertyDetail>;
