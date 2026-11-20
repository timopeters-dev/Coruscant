"use client";

import { Input } from "@/frontend/ui/input";
import { TextField } from "@/frontend/ui/field";
import { Label } from "@/frontend/ui/label";
import { Select } from "@/frontend/ui/select";
import type { PropertyUsage } from "@/domain/properties/properties";
import { PROPERTY_TYPES, type PropertyType } from "@/domain/properties/types";
import { PROPERTY_TYPE_LABELS } from "../labels";
import { DatePicker } from "@/frontend/ui/date-picker";
import { type PropertyFormState } from "./use-property-form";

/** Stammdaten und Bewertung einer Immobilie. */
export function PropertyBasisSection({ ws }: { ws: PropertyFormState }) {
  const {
    activeDraft, errors, estimatedValueEuro, hasExistingRentalValues, initialProperty,
    isSubmitting, maintenanceReservePotId, name, pots, propertyType, purchaseDate,
    purchasePriceEuro, setEstimatedValueEuro, setMaintenanceReservePotId, setName, setPropertyType,
    setPurchaseDate, setPurchasePriceEuro, setUsage, usage,
  } = ws;
  return (
    <>
      {/* Gruppe 1: Basis & Bewertung */}
      <div className="space-y-4">
        <p className="section-label text-[var(--text-secondary)]">
          Basis &amp; Bewertung
        </p>

        <TextField
          id="property-name"
          label="Bezeichnung *"
          value={name}
          onValueChange={setName}
          error={errors.name}
          placeholder={
              activeDraft
                ? "z. B. Wohnung Musterstraße 1"
                : "z. B. Immobilie #0 (Musterstraße 1)"
            }
          disabled={isSubmitting}
        />

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
            <Label htmlFor="property-type">Objekttyp (optional)</Label>
            <Select
              id="property-type"
              value={propertyType}
              onChange={(e) =>
                setPropertyType(e.target.value as PropertyType | "")
              }
              disabled={isSubmitting}
            >
              <option value="">– Nicht festgelegt –</option>
              {PROPERTY_TYPES.map((typeKey) => (
                <option key={typeKey} value={typeKey}>
                  {PROPERTY_TYPE_LABELS[typeKey]}
                </option>
              ))}
            </Select>
            <p className="text-2xs text-[var(--text-secondary)]">
              Nötig für die automatische Wertschätzung.
            </p>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="property-purchase-date">
              Kaufdatum (optional)
            </Label>
            <DatePicker
              id="property-purchase-date"
              value={purchaseDate}
              onChange={setPurchaseDate}
              hasError={Boolean(errors.purchaseDate)}
              disabled={isSubmitting}
            />
            {errors.purchaseDate ? (
              <p className="text-xs text-[var(--rose)]">
                {errors.purchaseDate}
              </p>
            ) : null}
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            id="property-purchase-price"
            label="Kaufpreis in € (optional)"
            value={purchasePriceEuro}
            onValueChange={setPurchasePriceEuro}
            error={errors.purchasePriceEuro}
            numeric="decimal"
            placeholder="z. B. 450000,00"
            disabled={isSubmitting}
          />

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
            ) : (
              <p className="text-2xs text-[var(--text-secondary)]">
                Manuell gesetzte Werte überschreibt die Auto-Schätzung nicht.
              </p>
            )}
            <p className="text-xs text-[var(--text-secondary)] tabular-nums">
              Stand: {initialProperty?.estimatedValueAsOf ?? "unbekannt"}. Bei
              Änderung wird heute gesetzt.
            </p>
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
    </>
  );
}
