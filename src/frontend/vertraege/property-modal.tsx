"use client";

import { Button } from "@/frontend/ui/button";
import { Dialog } from "@/frontend/ui/dialog";
import { StatusBadge } from "@/frontend/ui/status-badge";
import { type PropertyModalProps, usePropertyForm } from "./property-form/use-property-form";
import { PropertyBasisSection } from "./property-form/basis-section";
import { PropertyRentalSection } from "./property-form/rental-section";
import { PropertyAddressSection } from "./property-form/address-section";
import { PropertyBuildingSection } from "./property-form/building-section";

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

function PropertyModalInner(props: PropertyModalProps) {
  const ws = usePropertyForm(props);
  const { activeDraft, errors, handleSubmit, isEditing, isSubmitting, onOpenChange, open } = ws;
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

        <PropertyBasisSection ws={ws} />

        <PropertyRentalSection ws={ws} />

        <PropertyAddressSection ws={ws} />

        <PropertyBuildingSection ws={ws} />

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
