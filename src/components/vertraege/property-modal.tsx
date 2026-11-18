"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { StatusBadge } from "@/components/status-badge";
import type { PropertyRow } from "@/db/queries/contracts";
import {
  centsToEuroInputString,
  parseEuroInputToCents,
} from "@/lib/domain/money";
import type { PropertyUsage } from "@/lib/domain/properties";
import { PROPERTY_PURCHASE_LIMITS } from "@/lib/domain/property-purchase-defaults";
import type { PurchaseDraft } from "@/lib/validation/property-draft";
import { PROPERTY_ENERGY_CLASS_OPTIONS } from "./labels";

interface PropertyModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialProperty?: PropertyRow | null;
  draft?: PurchaseDraft | null;
  pots?: { id: string; name: string }[];
  onSaved: (savedProperty?: PropertyRow) => void;
}

interface FieldErrors {
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
  features?: string;
  general?: string;
}

function parseOptionalIntInput(
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

export function PropertyModal({
  open,
  onOpenChange,
  initialProperty,
  draft,
  pots = [],
  onSaved,
}: PropertyModalProps) {
  if (!open) {
    return null;
  }

  return (
    <PropertyModalInner
      key={initialProperty?.id ?? (draft ? "draft" : "new")}
      open={open}
      onOpenChange={onOpenChange}
      initialProperty={initialProperty}
      draft={draft}
      pots={pots}
      onSaved={onSaved}
    />
  );
}

function PropertyModalInner({
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

      const response = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: trimmedName,
          usage,
          purchaseDate: purchaseDate.trim() || null,
          purchasePriceCents,
          estimatedValueCents: estimatedCents,
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
          features: features.trim() || null,
        }),
      });

      const data = (await response.json()) as {
        property?: PropertyRow;
        error?: string;
        fieldErrors?: Record<string, string>;
      };

      if (!response.ok) {
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

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={isEditing ? "Immobilie bearbeiten" : "Immobilie anlegen"}
      description="Stammdaten, lokale Adresse und Bewertung für die Immobilie."
    >
      <form onSubmit={handleSubmit} className="space-y-5">
        {activeDraft ? (
          <div className="flex items-center justify-between gap-2 rounded-lg border border-dashed border-[var(--border)] bg-[var(--surface-elevated)]/60 px-3 py-2 text-xs text-[var(--text-secondary)]">
            <span>Entwurf aus dem Kaufrechner, bitte prüfen.</span>
            <StatusBadge variant="modeled" />
          </div>
        ) : null}

        {errors.general ? (
          <div className="rounded-lg border border-[var(--rose)]/40 bg-[var(--rose)]/10 px-3 py-2 text-xs text-[var(--rose)]">
            {errors.general}
          </div>
        ) : null}

        {/* Gruppe 1: Basis & Bewertung */}
        <div className="space-y-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--text-secondary)]">
            Basis &amp; Bewertung
          </p>

          <div className="space-y-1.5">
            <Label htmlFor="property-name">Bezeichnung *</Label>
            <Input
              id="property-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={
                activeDraft
                  ? "z. B. Wohnung Musterstraße 1"
                  : "z. B. Immobilie #0 (Musterstraße 1)"
              }
              hasError={Boolean(errors.name)}
              disabled={isSubmitting}
            />
            {errors.name ? (
              <p className="text-xs text-[var(--rose)]">{errors.name}</p>
            ) : null}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="property-usage">Nutzungsart</Label>
              <Select
                id="property-usage"
                value={usage}
                onChange={(e) => setUsage(e.target.value as PropertyUsage)}
                disabled={isSubmitting}
              >
                <option value="owner_occupied">Eigennutzung</option>
                <option value="rented">Vermietet</option>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="property-purchase-date">
                Kaufdatum (optional)
              </Label>
              <Input
                id="property-purchase-date"
                type="date"
                value={purchaseDate}
                onChange={(e) => setPurchaseDate(e.target.value)}
                hasError={Boolean(errors.purchaseDate)}
                disabled={isSubmitting}
                className="tabular-nums"
              />
              {errors.purchaseDate ? (
                <p className="text-xs text-[var(--rose)]">
                  {errors.purchaseDate}
                </p>
              ) : null}
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="property-purchase-price">
                Kaufpreis in € (optional)
              </Label>
              <Input
                id="property-purchase-price"
                inputMode="decimal"
                value={purchasePriceEuro}
                onChange={(e) => setPurchasePriceEuro(e.target.value)}
                placeholder="z. B. 450000,00"
                hasError={Boolean(errors.purchasePriceEuro)}
                disabled={isSubmitting}
                className="tabular-nums"
              />
              {errors.purchasePriceEuro ? (
                <p className="text-xs text-[var(--rose)]">
                  {errors.purchasePriceEuro}
                </p>
              ) : null}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="property-estimated-value">
                Aktueller Schätzwert in € *
              </Label>
              <Input
                id="property-estimated-value"
                inputMode="decimal"
                value={estimatedValueEuro}
                onChange={(e) => setEstimatedValueEuro(e.target.value)}
                placeholder="z. B. 480000,00"
                hasError={Boolean(errors.estimatedValueEuro)}
                disabled={isSubmitting}
                className="tabular-nums"
              />
              {errors.estimatedValueEuro ? (
                <p className="text-xs text-[var(--rose)]">
                  {errors.estimatedValueEuro}
                </p>
              ) : null}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="property-maintenance-pot">
              Instandhaltungs-Topf (optional)
            </Label>
            <Select
              id="property-maintenance-pot"
              value={maintenanceReservePotId}
              onChange={(e) => setMaintenanceReservePotId(e.target.value)}
              disabled={isSubmitting}
            >
              <option value="">–</option>
              {pots.map((pot) => (
                <option key={pot.id} value={pot.id}>
                  {pot.name}
                </option>
              ))}
            </Select>
            {errors.maintenanceReservePotId ? (
              <p className="text-xs text-[var(--rose)]">
                {errors.maintenanceReservePotId}
              </p>
            ) : null}
          </div>

          {usage === "owner_occupied" && hasExistingRentalValues ? (
            <p className="rounded-lg border border-dashed border-[var(--border)] bg-[var(--surface-elevated)]/60 px-3 py-2 text-xs text-[var(--text-secondary)]">
              Mietdaten werden beim Speichern entfernt.
            </p>
          ) : null}
        </div>

        {/* Gruppe 1b: Vermietung (nur bei usage === 'rented') */}
        {usage === "rented" ? (
          <div className="space-y-4 border-t border-[var(--border)] pt-4">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-[var(--text-secondary)]">
                Vermietung
              </p>
              <StatusBadge variant="modeled" />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="property-cold-rent">
                  Kaltmiete / Monat in €
                </Label>
                <Input
                  id="property-cold-rent"
                  inputMode="decimal"
                  value={monthlyColdRentEuro}
                  onChange={(e) => setMonthlyColdRentEuro(e.target.value)}
                  placeholder="z. B. 800,00"
                  hasError={Boolean(errors.monthlyColdRentEuro)}
                  disabled={isSubmitting}
                  className="tabular-nums"
                />
                {errors.monthlyColdRentEuro ? (
                  <p className="text-xs text-[var(--rose)]">
                    {errors.monthlyColdRentEuro}
                  </p>
                ) : null}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="property-non-recoverable">
                  Nicht umlagefähige Kosten / Monat in €
                </Label>
                <Input
                  id="property-non-recoverable"
                  inputMode="decimal"
                  value={monthlyNonRecoverableCostsEuro}
                  onChange={(e) =>
                    setMonthlyNonRecoverableCostsEuro(e.target.value)
                  }
                  placeholder="z. B. 60,00"
                  hasError={Boolean(errors.monthlyNonRecoverableCostsEuro)}
                  disabled={isSubmitting}
                  className="tabular-nums"
                />
                {errors.monthlyNonRecoverableCostsEuro ? (
                  <p className="text-xs text-[var(--rose)]">
                    {errors.monthlyNonRecoverableCostsEuro}
                  </p>
                ) : null}
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="property-maintenance-allowance">
                  Instandhaltungs-Rücklage / Monat in €
                </Label>
                <Input
                  id="property-maintenance-allowance"
                  inputMode="decimal"
                  value={monthlyMaintenanceAllowanceEuro}
                  onChange={(e) =>
                    setMonthlyMaintenanceAllowanceEuro(e.target.value)
                  }
                  placeholder="z. B. 50,00"
                  hasError={Boolean(errors.monthlyMaintenanceAllowanceEuro)}
                  disabled={isSubmitting}
                  className="tabular-nums"
                />
                {errors.monthlyMaintenanceAllowanceEuro ? (
                  <p className="text-xs text-[var(--rose)]">
                    {errors.monthlyMaintenanceAllowanceEuro}
                  </p>
                ) : null}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="property-depreciation-basis">
                  AfA-Bemessungsgrundlage in € (optional)
                </Label>
                <Input
                  id="property-depreciation-basis"
                  inputMode="decimal"
                  value={depreciationBasisEuro}
                  onChange={(e) => setDepreciationBasisEuro(e.target.value)}
                  placeholder="z. B. 180000,00"
                  hasError={Boolean(errors.depreciationBasisEuro)}
                  disabled={isSubmitting}
                  className="tabular-nums"
                />
                <p className="text-[11px] text-[var(--text-secondary)]">
                  nur Datenfeld, keine Steuerberechnung
                </p>
                {errors.depreciationBasisEuro ? (
                  <p className="text-xs text-[var(--rose)]">
                    {errors.depreciationBasisEuro}
                  </p>
                ) : null}
              </div>
            </div>
          </div>
        ) : null}

        {/* Gruppe 2: Adresse (rein lokal, optional) */}
        <div className="space-y-4 border-t border-[var(--border)] pt-4">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-[var(--text-secondary)]">
              Adresse (optional)
            </p>
            <span className="text-[11px] text-[var(--text-secondary)]">
              Rein lokal gespeichert
            </span>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="property-street">Straße</Label>
              <Input
                id="property-street"
                value={street}
                onChange={(e) => setStreet(e.target.value)}
                placeholder="z. B. Musterstraße"
                hasError={Boolean(errors.street)}
                disabled={isSubmitting}
              />
              {errors.street ? (
                <p className="text-xs text-[var(--rose)]">{errors.street}</p>
              ) : null}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="property-house-number">Hausnummer</Label>
              <Input
                id="property-house-number"
                value={houseNumber}
                onChange={(e) => setHouseNumber(e.target.value)}
                placeholder="z. B. 12a"
                hasError={Boolean(errors.houseNumber)}
                disabled={isSubmitting}
                className="tabular-nums"
              />
              {errors.houseNumber ? (
                <p className="text-xs text-[var(--rose)]">
                  {errors.houseNumber}
                </p>
              ) : null}
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="property-postal-code">PLZ</Label>
              <Input
                id="property-postal-code"
                value={postalCode}
                onChange={(e) => setPostalCode(e.target.value)}
                placeholder="z. B. 12345"
                hasError={Boolean(errors.postalCode)}
                disabled={isSubmitting}
                className="tabular-nums"
              />
              {errors.postalCode ? (
                <p className="text-xs text-[var(--rose)]">
                  {errors.postalCode}
                </p>
              ) : null}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="property-city">Ort</Label>
              <Input
                id="property-city"
                value={city}
                onChange={(e) => setCity(e.target.value)}
                placeholder="z. B. Musterstadt"
                hasError={Boolean(errors.city)}
                disabled={isSubmitting}
              />
              {errors.city ? (
                <p className="text-xs text-[var(--rose)]">{errors.city}</p>
              ) : null}
            </div>
          </div>
        </div>

        {/* Gruppe 3: Gebäudedaten & Besonderheiten (optional) */}
        <div className="space-y-4 border-t border-[var(--border)] pt-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--text-secondary)]">
            Gebäudedaten &amp; Besonderheiten (optional)
          </p>

          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="property-living-area">Wohnfläche (m²)</Label>
              <Input
                id="property-living-area"
                inputMode="numeric"
                value={livingAreaSqm}
                onChange={(e) => setLivingAreaSqm(e.target.value)}
                placeholder="z. B. 145"
                hasError={Boolean(errors.livingAreaSqm)}
                disabled={isSubmitting}
                className="tabular-nums"
              />
              {errors.livingAreaSqm ? (
                <p className="text-xs text-[var(--rose)]">
                  {errors.livingAreaSqm}
                </p>
              ) : null}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="property-usable-area">Nutzfläche (m²)</Label>
              <Input
                id="property-usable-area"
                inputMode="numeric"
                value={usableAreaSqm}
                onChange={(e) => setUsableAreaSqm(e.target.value)}
                placeholder="z. B. 40"
                hasError={Boolean(errors.usableAreaSqm)}
                disabled={isSubmitting}
                className="tabular-nums"
              />
              {errors.usableAreaSqm ? (
                <p className="text-xs text-[var(--rose)]">
                  {errors.usableAreaSqm}
                </p>
              ) : null}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="property-plot-area">Grundstück (m²)</Label>
              <Input
                id="property-plot-area"
                inputMode="numeric"
                value={plotAreaSqm}
                onChange={(e) => setPlotAreaSqm(e.target.value)}
                placeholder="z. B. 520"
                hasError={Boolean(errors.plotAreaSqm)}
                disabled={isSubmitting}
                className="tabular-nums"
              />
              {errors.plotAreaSqm ? (
                <p className="text-xs text-[var(--rose)]">
                  {errors.plotAreaSqm}
                </p>
              ) : null}
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="property-construction-year">Baujahr</Label>
              <Input
                id="property-construction-year"
                inputMode="numeric"
                value={constructionYear}
                onChange={(e) => setConstructionYear(e.target.value)}
                placeholder="z. B. 1998"
                hasError={Boolean(errors.constructionYear)}
                disabled={isSubmitting}
                className="tabular-nums"
              />
              {errors.constructionYear ? (
                <p className="text-xs text-[var(--rose)]">
                  {errors.constructionYear}
                </p>
              ) : null}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="property-energy-class">
                Energieeffizienzklasse
              </Label>
              <Select
                id="property-energy-class"
                value={energyClass}
                onChange={(e) => setEnergyClass(e.target.value)}
                disabled={isSubmitting}
              >
                <option value="">–</option>
                {PROPERTY_ENERGY_CLASS_OPTIONS.map((cls) => (
                  <option key={cls} value={cls}>
                    {cls}
                  </option>
                ))}
              </Select>
              {errors.energyClass ? (
                <p className="text-xs text-[var(--rose)]">
                  {errors.energyClass}
                </p>
              ) : null}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="property-features">Besonderheiten</Label>
            <textarea
              id="property-features"
              rows={2}
              maxLength={500}
              value={features}
              onChange={(e) => setFeatures(e.target.value)}
              placeholder="z. B. Kamin, Sauna, Photovoltaik, Doppelgarage"
              disabled={isSubmitting}
              className="flex w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-secondary)]/70 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-50"
            />
            {errors.features ? (
              <p className="text-xs text-[var(--rose)]">{errors.features}</p>
            ) : null}
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t border-[var(--border)] pt-4">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isSubmitting}
          >
            Abbrechen
          </Button>
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting
              ? "Speichert..."
              : isEditing
                ? "Änderungen speichern"
                : "Immobilie anlegen"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
