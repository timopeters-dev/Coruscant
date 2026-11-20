"use client";

import { Badge } from "@/frontend/ui/badge";
import { RENOVATION_KIND_LABELS } from "../labels";
import { type PropertyDetailState } from "./use-property-detail";

/** Adresse und Gebäudedaten (nur lokal gespeichert). */
export function PropertyMetadataSection({ ws }: { ws: PropertyDetailState }) {
  const { formattedAddress, hasMetadata, parsedRenovations, property } = ws;
  return (
    <>
      {/* Stammdaten-Block */}
      {hasMetadata ? (
        <div className="space-y-2 rounded-xl border border-[var(--border)] p-4 text-sm">
          <p className="section-label text-[var(--text-secondary)]">
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

          {parsedRenovations.length > 0 ? (
            <div className="flex items-start justify-between gap-3">
              <span className="text-[var(--text-secondary)]">Sanierungen</span>
              <span className="text-right tabular-nums font-medium text-[var(--text-primary)]">
                {parsedRenovations
                  .map(
                    (item) =>
                      `${item.year} ${RENOVATION_KIND_LABELS[item.kind]}`,
                  )
                  .join(" · ")}
              </span>
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
    </>
  );
}
