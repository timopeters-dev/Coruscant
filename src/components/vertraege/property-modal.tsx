"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import type { PropertyRow } from "@/db/queries/contracts";
import {
  centsToEuroInputString,
  parseEuroInputToCents,
} from "@/lib/domain/money";
import type { PropertyUsage } from "@/lib/domain/properties";

interface PropertyModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialProperty?: PropertyRow | null;
  onSaved: () => void;
}

interface FieldErrors {
  name?: string;
  purchaseDate?: string;
  purchasePriceEuro?: string;
  estimatedValueEuro?: string;
  general?: string;
}

export function PropertyModal({
  open,
  onOpenChange,
  initialProperty,
  onSaved,
}: PropertyModalProps) {
  if (!open) {
    return null;
  }

  return (
    <PropertyModalInner
      key={initialProperty?.id ?? "new"}
      open={open}
      onOpenChange={onOpenChange}
      initialProperty={initialProperty}
      onSaved={onSaved}
    />
  );
}

function PropertyModalInner({
  open,
  onOpenChange,
  initialProperty,
  onSaved,
}: PropertyModalProps) {
  const isEditing = Boolean(initialProperty);

  const [name, setName] = React.useState(initialProperty?.name ?? "");
  const [usage, setUsage] = React.useState<PropertyUsage>(
    initialProperty?.usage ?? "owner_occupied",
  );
  const [purchaseDate, setPurchaseDate] = React.useState(
    initialProperty?.purchaseDate ?? "",
  );
  const [purchasePriceEuro, setPurchasePriceEuro] = React.useState(
    initialProperty?.purchasePriceCents != null
      ? centsToEuroInputString(initialProperty.purchasePriceCents)
      : "",
  );
  const [estimatedValueEuro, setEstimatedValueEuro] = React.useState(
    initialProperty
      ? centsToEuroInputString(initialProperty.estimatedValueCents)
      : "",
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
        }),
      });

      const data = (await response.json()) as {
        error?: string;
        fieldErrors?: Record<string, string>;
      };

      if (!response.ok) {
        setErrors({
          name: data.fieldErrors?.name,
          purchaseDate: data.fieldErrors?.purchaseDate,
          purchasePriceEuro: data.fieldErrors?.purchasePriceCents,
          estimatedValueEuro: data.fieldErrors?.estimatedValueCents,
          general: data.error ?? "Speichern fehlgeschlagen.",
        });
        setIsSubmitting(false);
        return;
      }

      onOpenChange(false);
      onSaved();
    } catch {
      setErrors({
        general: "Netzwerkfehler beim Speichern der Immobilie.",
      });
      setIsSubmitting(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={isEditing ? "Immobilie bearbeiten" : "Immobilie anlegen"}
      description="Stammdaten und Bewertung für Immobilie #0 (v1-Felder)."
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {errors.general ? (
          <div className="rounded-lg border border-[var(--rose)]/40 bg-[var(--rose)]/10 px-3 py-2 text-xs text-[var(--rose)]">
            {errors.general}
          </div>
        ) : null}

        <div className="space-y-1.5">
          <Label htmlFor="property-name">Bezeichnung *</Label>
          <Input
            id="property-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="z. B. Immobilie #0 (Musterstraße 1)"
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
            <Label htmlFor="property-purchase-date">Kaufdatum (optional)</Label>
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
