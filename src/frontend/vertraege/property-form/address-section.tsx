"use client";

import { TextField } from "@/frontend/ui/field";
import { type PropertyFormState } from "./use-property-form";

/** Adresse – bleibt lokal, geht nie an die Wertschätzung. */
export function PropertyAddressSection({ ws }: { ws: PropertyFormState }) {
  const {
    city, errors, houseNumber, isSubmitting, postalCode, setCity, setHouseNumber, setPostalCode,
    setStreet, street,
  } = ws;
  return (
    <>
      {/* Gruppe 2: Adresse (rein lokal, optional) */}
      <div className="space-y-4 border-t border-[var(--border)] pt-4">
        <div className="flex items-center justify-between gap-2">
          <p className="section-label text-[var(--text-secondary)]">
            Adresse (optional)
          </p>
          <span className="text-2xs text-[var(--text-secondary)]">
            Rein lokal gespeichert
          </span>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            id="property-street"
            label="Straße"
            value={street}
            onValueChange={setStreet}
            error={errors.street}
            placeholder="z. B. Musterstraße"
            disabled={isSubmitting}
          />

          <TextField
            id="property-house-number"
            label="Hausnummer"
            value={houseNumber}
            onValueChange={setHouseNumber}
            error={errors.houseNumber}
            placeholder="z. B. 12a"
            disabled={isSubmitting}
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            id="property-postal-code"
            label="PLZ"
            value={postalCode}
            onValueChange={setPostalCode}
            error={errors.postalCode}
            placeholder="z. B. 12345"
            disabled={isSubmitting}
          />

          <TextField
            id="property-city"
            label="Ort"
            value={city}
            onValueChange={setCity}
            error={errors.city}
            placeholder="z. B. Musterstadt"
            disabled={isSubmitting}
          />
        </div>
      </div>
    </>
  );
}
