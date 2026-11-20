"use client";

import * as React from "react";
import type { PropertyRow } from "@/backend/db/queries/properties";
import { centsToEuroInputString, parseEuroInputToCents } from "@/domain/core/money";
import type { PropertyUsage } from "@/domain/properties/properties";
import { type PropertyType } from "@/domain/properties/types";
import { PROPERTY_PURCHASE_LIMITS } from "@/domain/planning/purchase-defaults";
import {
  parseRenovations, type Renovation, type RenovationKind,
} from "@/domain/properties/renovations";
import type { PurchaseDraft } from "@/validation/property-draft";

export interface PropertyModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialProperty?: PropertyRow | null;
  draft?: PurchaseDraft | null;
  pots?: { id: string; name: string }[];
  onSaved: (savedProperty?: PropertyRow) => void;
}

export interface FieldErrors {
  name?: string;
  purchaseDate?: string;
  purchasePriceEuro?: string;
  estimatedValueEuro?: string;
  maintenanceReservePotId?: string;
  monthlyColdRentEuro?: string;
  monthlyNonRecoverableCostsEuro?: string;
  monthlyMaintenanceAllowanceEuro?: string;
  depreciationBasisEuro?: string;
  street?: string;
  houseNumber?: string;
  postalCode?: string;
  city?: string;
  livingAreaSqm?: string;
  usableAreaSqm?: string;
  plotAreaSqm?: string;
  constructionYear?: string;
  energyClass?: string;
  renovations?: string;
  features?: string;
  general?: string;
}

export function parseOptionalIntInput(
  raw: string,
  min: number,
  max: number,
  label: string,
): { value: number | null; error?: string } {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { value: null };
  }
  if (!/^\d+$/.test(trimmed)) {
    return {
      value: null,
      error: `${label} muss eine ganze Zahl zwischen ${min} und ${max} sein.`,
    };
  }
  const parsed = Number.parseInt(trimmed, 10);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    return {
      value: null,
      error: `${label} muss zwischen ${min} und ${max} liegen.`,
    };
  }
  return { value: parsed };
}


/** Zustand, Ableitungen und Aktionen von PropertyModalInner. */
export function usePropertyForm({
  open,
  onOpenChange,
  initialProperty,
  draft,
  pots = [],
  onSaved,
}: PropertyModalProps) {
  const isEditing = Boolean(initialProperty);
  const activeDraft = !isEditing ? (draft ?? null) : null;

  const [name, setName] = React.useState(initialProperty?.name ?? "");
  const [usage, setUsage] = React.useState<PropertyUsage>(
    initialProperty?.usage ?? (activeDraft ? "rented" : "owner_occupied"),
  );
  const [propertyType, setPropertyType] = React.useState<PropertyType | "">(
    initialProperty?.propertyType ?? "",
  );
  const [purchaseDate, setPurchaseDate] = React.useState(
    initialProperty?.purchaseDate ?? "",
  );
  const [purchasePriceEuro, setPurchasePriceEuro] = React.useState(
    initialProperty?.purchasePriceCents != null
      ? centsToEuroInputString(initialProperty.purchasePriceCents)
      : activeDraft
        ? centsToEuroInputString(activeDraft.purchasePriceCents)
        : "",
  );
  const [estimatedValueEuro, setEstimatedValueEuro] = React.useState(
    initialProperty
      ? centsToEuroInputString(initialProperty.estimatedValueCents)
      : activeDraft
        ? centsToEuroInputString(activeDraft.purchasePriceCents)
        : "",
  );
  const [maintenanceReservePotId, setMaintenanceReservePotId] = React.useState(
    initialProperty?.maintenanceReservePotId ?? "",
  );

  // Vermietungs-Profil (nur bei usage === 'rented')
  const [monthlyColdRentEuro, setMonthlyColdRentEuro] = React.useState(
    initialProperty?.monthlyColdRentCents != null
      ? centsToEuroInputString(initialProperty.monthlyColdRentCents)
      : activeDraft
        ? centsToEuroInputString(activeDraft.monthlyColdRentCents)
        : "",
  );
  const [monthlyNonRecoverableCostsEuro, setMonthlyNonRecoverableCostsEuro] =
    React.useState(
      initialProperty?.monthlyNonRecoverableCostsCents != null
        ? centsToEuroInputString(
            initialProperty.monthlyNonRecoverableCostsCents,
          )
        : activeDraft
          ? centsToEuroInputString(activeDraft.monthlyNonRecoverableCostsCents)
          : "",
    );
  const [
    monthlyMaintenanceAllowanceEuro,
    setMonthlyMaintenanceAllowanceEuro,
  ] = React.useState(
    initialProperty?.monthlyMaintenanceAllowanceCents != null
      ? centsToEuroInputString(
          initialProperty.monthlyMaintenanceAllowanceCents,
        )
      : activeDraft
        ? centsToEuroInputString(activeDraft.monthlyMaintenanceAllowanceCents)
        : "",
  );
  const [depreciationBasisEuro, setDepreciationBasisEuro] = React.useState(
    initialProperty?.depreciationBasisCents != null
      ? centsToEuroInputString(initialProperty.depreciationBasisCents)
      : "",
  );

  // Adresse (rein lokal, optional)
  const [street, setStreet] = React.useState(initialProperty?.street ?? "");
  const [houseNumber, setHouseNumber] = React.useState(
    initialProperty?.houseNumber ?? "",
  );
  const [postalCode, setPostalCode] = React.useState(
    initialProperty?.postalCode ?? "",
  );
  const [city, setCity] = React.useState(initialProperty?.city ?? "");

  // Gebäudedaten & Besonderheiten (optional)
  const [livingAreaSqm, setLivingAreaSqm] = React.useState(
    initialProperty?.livingAreaSqm != null
      ? String(initialProperty.livingAreaSqm)
      : "",
  );
  const [usableAreaSqm, setUsableAreaSqm] = React.useState(
    initialProperty?.usableAreaSqm != null
      ? String(initialProperty.usableAreaSqm)
      : "",
  );
  const [plotAreaSqm, setPlotAreaSqm] = React.useState(
    initialProperty?.plotAreaSqm != null
      ? String(initialProperty.plotAreaSqm)
      : "",
  );
  const [constructionYear, setConstructionYear] = React.useState(
    initialProperty?.constructionYear != null
      ? String(initialProperty.constructionYear)
      : "",
  );
  const [energyClass, setEnergyClass] = React.useState(
    initialProperty?.energyClass ?? "",
  );
  const initialRenovations = React.useMemo(
    () =>
      parseRenovations(initialProperty?.renovations ?? null).map((item) => ({
        year: String(item.year),
        kind: item.kind,
      })),
    [initialProperty?.renovations],
  );
  const [renovations, setRenovations] =
    React.useState<Array<{ year: string; kind: RenovationKind }>>(
      initialRenovations,
    );
  const [renovationsOpen, setRenovationsOpen] = React.useState(
    initialRenovations.length > 0,
  );
  const [features, setFeatures] = React.useState(
    initialProperty?.features ?? "",
  );

  const [errors, setErrors] = React.useState<FieldErrors>({});
  const [isSubmitting, setIsSubmitting] = React.useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextErrors: FieldErrors = {};

    const trimmedName = name.trim();
    if (!trimmedName) {
      nextErrors.name = "Bitte einen Namen für die Immobilie angeben.";
    }

    const estimatedCents = parseEuroInputToCents(estimatedValueEuro);
    if (estimatedCents === null || estimatedCents < 0) {
      nextErrors.estimatedValueEuro =
        "Bitte einen gültigen Betrag >= 0,00 € eingeben (z. B. 480000,00).";
    }

    let purchasePriceCents: number | null = null;
    if (purchasePriceEuro.trim().length > 0) {
      const parsedPurchase = parseEuroInputToCents(purchasePriceEuro);
      if (parsedPurchase === null || parsedPurchase < 0) {
        nextErrors.purchasePriceEuro =
          "Bitte einen gültigen Kaufpreis >= 0,00 € eingeben.";
      } else {
        purchasePriceCents = parsedPurchase;
      }
    }

    const parsedLivingArea = parseOptionalIntInput(
      livingAreaSqm,
      1,
      1_000_000,
      "Wohnfläche",
    );
    if (parsedLivingArea.error) {
      nextErrors.livingAreaSqm = parsedLivingArea.error;
    }

    const parsedUsableArea = parseOptionalIntInput(
      usableAreaSqm,
      1,
      1_000_000,
      "Nutzfläche",
    );
    if (parsedUsableArea.error) {
      nextErrors.usableAreaSqm = parsedUsableArea.error;
    }

    const parsedPlotArea = parseOptionalIntInput(
      plotAreaSqm,
      1,
      1_000_000,
      "Grundstücksfläche",
    );
    if (parsedPlotArea.error) {
      nextErrors.plotAreaSqm = parsedPlotArea.error;
    }

    const parsedConstructionYear = parseOptionalIntInput(
      constructionYear,
      1500,
      2100,
      "Baujahr",
    );
    if (parsedConstructionYear.error) {
      nextErrors.constructionYear = parsedConstructionYear.error;
    }

    if (features.trim().length > 500) {
      nextErrors.features = "Maximal 500 Zeichen erlaubt.";
    }

    const parsedRenovations: Renovation[] = [];
    for (let i = 0; i < renovations.length; i++) {
      const item = renovations[i]!;
      const yearNum = Number(item.year.trim());
      if (
        !item.year.trim() ||
        !Number.isInteger(yearNum) ||
        yearNum < 1800 ||
        yearNum > 2100
      ) {
        nextErrors.renovations =
          "Jede Sanierung benötigt ein gültiges Jahr (1800–2100).";
        break;
      }
      parsedRenovations.push({ year: yearNum, kind: item.kind });
    }

    function parseOptionalRentalEuro(
      raw: string,
      maxCents: number,
      label: string,
    ): { value: number | null; error?: string } {
      const trimmed = raw.trim();
      if (!trimmed) {
        return { value: null };
      }
      const cents = parseEuroInputToCents(trimmed);
      if (cents === null || cents < 0 || cents > maxCents) {
        return {
          value: null,
          error: `${label} muss zwischen 0,00 € und ${centsToEuroInputString(maxCents)} € liegen.`,
        };
      }
      return { value: cents };
    }

    let monthlyColdRentCents: number | null = null;
    let monthlyNonRecoverableCostsCents: number | null = null;
    let monthlyMaintenanceAllowanceCents: number | null = null;
    let depreciationBasisCents: number | null = null;

    if (usage === "rented") {
      const parsedRent = parseOptionalRentalEuro(
        monthlyColdRentEuro,
        PROPERTY_PURCHASE_LIMITS.monthlyColdRentCents.max,
        "Kaltmiete",
      );
      if (parsedRent.error) {
        nextErrors.monthlyColdRentEuro = parsedRent.error;
      } else {
        monthlyColdRentCents = parsedRent.value;
      }

      const parsedNonRec = parseOptionalRentalEuro(
        monthlyNonRecoverableCostsEuro,
        PROPERTY_PURCHASE_LIMITS.monthlyNonRecoverableCostsCents.max,
        "Nicht umlagefähige Kosten",
      );
      if (parsedNonRec.error) {
        nextErrors.monthlyNonRecoverableCostsEuro = parsedNonRec.error;
      } else {
        monthlyNonRecoverableCostsCents = parsedNonRec.value;
      }

      const parsedMaint = parseOptionalRentalEuro(
        monthlyMaintenanceAllowanceEuro,
        PROPERTY_PURCHASE_LIMITS.monthlyMaintenanceCents.max,
        "Instandhaltungs-Rücklage",
      );
      if (parsedMaint.error) {
        nextErrors.monthlyMaintenanceAllowanceEuro = parsedMaint.error;
      } else {
        monthlyMaintenanceAllowanceCents = parsedMaint.value;
      }

      const parsedDepr = parseOptionalRentalEuro(
        depreciationBasisEuro,
        10_000_000_000,
        "AfA-Bemessungsgrundlage",
      );
      if (parsedDepr.error) {
        nextErrors.depreciationBasisEuro = parsedDepr.error;
      } else {
        depreciationBasisCents = parsedDepr.value;
      }
    }

    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      return;
    }

    setIsSubmitting(true);
    setErrors({});

    try {
      const url = initialProperty
        ? `/api/properties/${initialProperty.id}`
        : "/api/properties";
      const method = initialProperty ? "PATCH" : "POST";

      const shouldSendEstimatedValue =
        !initialProperty ||
        estimatedCents !== initialProperty.estimatedValueCents;

      const response = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: trimmedName,
          usage,
          propertyType: propertyType || null,
          purchaseDate: purchaseDate.trim() || null,
          purchasePriceCents,
          ...(shouldSendEstimatedValue
            ? { estimatedValueCents: estimatedCents }
            : {}),
          maintenanceReservePotId: maintenanceReservePotId || null,
          monthlyColdRentCents,
          monthlyNonRecoverableCostsCents,
          monthlyMaintenanceAllowanceCents,
          depreciationBasisCents,
          street: street.trim() || null,
          houseNumber: houseNumber.trim() || null,
          postalCode: postalCode.trim() || null,
          city: city.trim() || null,
          livingAreaSqm: parsedLivingArea.value,
          usableAreaSqm: parsedUsableArea.value,
          plotAreaSqm: parsedPlotArea.value,
          constructionYear: parsedConstructionYear.value,
          energyClass: energyClass || null,
          renovations:
            parsedRenovations.length > 0 ? parsedRenovations : null,
          features: features.trim() || null,
        }),
      });

      const data = (await response.json()) as {
        property?: PropertyRow;
        error?: string;
        fieldErrors?: Record<string, string>;
      };

      if (!response.ok) {
        const renovationFieldError =
          data.fieldErrors?.renovations ??
          Object.entries(data.fieldErrors ?? {}).find(([key]) =>
            key.startsWith("renovations."),
          )?.[1];

        setErrors({
          name: data.fieldErrors?.name,
          purchaseDate: data.fieldErrors?.purchaseDate,
          purchasePriceEuro: data.fieldErrors?.purchasePriceCents,
          estimatedValueEuro: data.fieldErrors?.estimatedValueCents,
          maintenanceReservePotId: data.fieldErrors?.maintenanceReservePotId,
          monthlyColdRentEuro: data.fieldErrors?.monthlyColdRentCents,
          monthlyNonRecoverableCostsEuro:
            data.fieldErrors?.monthlyNonRecoverableCostsCents,
          monthlyMaintenanceAllowanceEuro:
            data.fieldErrors?.monthlyMaintenanceAllowanceCents,
          depreciationBasisEuro: data.fieldErrors?.depreciationBasisCents,
          street: data.fieldErrors?.street,
          houseNumber: data.fieldErrors?.houseNumber,
          postalCode: data.fieldErrors?.postalCode,
          city: data.fieldErrors?.city,
          livingAreaSqm: data.fieldErrors?.livingAreaSqm,
          usableAreaSqm: data.fieldErrors?.usableAreaSqm,
          plotAreaSqm: data.fieldErrors?.plotAreaSqm,
          constructionYear: data.fieldErrors?.constructionYear,
          energyClass: data.fieldErrors?.energyClass,
          renovations: renovationFieldError,
          features: data.fieldErrors?.features,
          general: data.error ?? "Speichern fehlgeschlagen.",
        });
        setIsSubmitting(false);
        return;
      }

      onOpenChange(false);
      onSaved(data.property);
    } catch {
      setErrors({
        general: "Netzwerkfehler beim Speichern der Immobilie.",
      });
      setIsSubmitting(false);
    }
  }

  const hasExistingRentalValues = Boolean(
    monthlyColdRentEuro.trim() ||
      monthlyNonRecoverableCostsEuro.trim() ||
      monthlyMaintenanceAllowanceEuro.trim() ||
      depreciationBasisEuro.trim() ||
      initialProperty?.monthlyColdRentCents != null ||
      initialProperty?.monthlyNonRecoverableCostsCents != null ||
      initialProperty?.monthlyMaintenanceAllowanceCents != null ||
      initialProperty?.depreciationBasisCents != null,
  );

  return {
    activeDraft,
    city,
    constructionYear,
    depreciationBasisEuro,
    draft,
    energyClass,
    errors,
    estimatedValueEuro,
    features,
    handleSubmit,
    hasExistingRentalValues,
    houseNumber,
    initialProperty,
    initialRenovations,
    isEditing,
    isSubmitting,
    livingAreaSqm,
    maintenanceReservePotId,
    monthlyColdRentEuro,
    monthlyMaintenanceAllowanceEuro,
    monthlyNonRecoverableCostsEuro,
    name,
    onOpenChange,
    onSaved,
    open,
    plotAreaSqm,
    postalCode,
    pots,
    propertyType,
    purchaseDate,
    purchasePriceEuro,
    renovations,
    renovationsOpen,
    setCity,
    setConstructionYear,
    setDepreciationBasisEuro,
    setEnergyClass,
    setErrors,
    setEstimatedValueEuro,
    setFeatures,
    setHouseNumber,
    setIsSubmitting,
    setLivingAreaSqm,
    setMaintenanceReservePotId,
    setMonthlyColdRentEuro,
    setMonthlyMaintenanceAllowanceEuro,
    setMonthlyNonRecoverableCostsEuro,
    setName,
    setPlotAreaSqm,
    setPostalCode,
    setPropertyType,
    setPurchaseDate,
    setPurchasePriceEuro,
    setRenovations,
    setRenovationsOpen,
    setStreet,
    setUsableAreaSqm,
    setUsage,
    street,
    usableAreaSqm,
    usage,
  };
}

export type PropertyFormState = ReturnType<typeof usePropertyForm>;
