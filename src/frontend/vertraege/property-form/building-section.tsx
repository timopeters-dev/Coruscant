"use client";

import { Button } from "@/frontend/ui/button";
import { Input } from "@/frontend/ui/input";
import { TextField } from "@/frontend/ui/field";
import { Label } from "@/frontend/ui/label";
import { Select } from "@/frontend/ui/select";
import {
  MAX_RENOVATIONS, RENOVATION_KINDS, type RenovationKind,
} from "@/domain/properties/renovations";
import { PROPERTY_ENERGY_CLASS_OPTIONS, RENOVATION_KIND_LABELS } from "../labels";
import { type PropertyFormState } from "./use-property-form";

/** Gebäudedaten, Sanierungen und Besonderheiten. */
export function PropertyBuildingSection({ ws }: { ws: PropertyFormState }) {
  const {
    constructionYear, energyClass, errors, features, isSubmitting, livingAreaSqm, plotAreaSqm,
    renovations, renovationsOpen, setConstructionYear, setEnergyClass, setFeatures,
    setLivingAreaSqm, setPlotAreaSqm, setRenovations, setRenovationsOpen, setUsableAreaSqm,
    usableAreaSqm,
  } = ws;
  return (
    <>
      {/* Gruppe 3: Gebäudedaten & Besonderheiten (optional) */}
      <div className="space-y-4 border-t border-[var(--border)] pt-4">
        <p className="section-label text-[var(--text-secondary)]">
          Gebäudedaten &amp; Besonderheiten (optional)
        </p>

        <div className="grid gap-4 sm:grid-cols-3">
          <TextField
            id="property-living-area"
            label="Wohnfläche (m²)"
            value={livingAreaSqm}
            onValueChange={setLivingAreaSqm}
            error={errors.livingAreaSqm}
            numeric="numeric"
            placeholder="z. B. 145"
            disabled={isSubmitting}
          />

          <TextField
            id="property-usable-area"
            label="Nutzfläche (m²)"
            value={usableAreaSqm}
            onValueChange={setUsableAreaSqm}
            error={errors.usableAreaSqm}
            numeric="numeric"
            placeholder="z. B. 40"
            disabled={isSubmitting}
          />

          <TextField
            id="property-plot-area"
            label="Grundstück (m²)"
            value={plotAreaSqm}
            onValueChange={setPlotAreaSqm}
            error={errors.plotAreaSqm}
            numeric="numeric"
            placeholder="z. B. 520"
            disabled={isSubmitting}
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            id="property-construction-year"
            label="Baujahr"
            value={constructionYear}
            onValueChange={setConstructionYear}
            error={errors.constructionYear}
            numeric="numeric"
            placeholder="z. B. 1998"
            disabled={isSubmitting}
          />

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

        <div className="space-y-2 rounded-lg border border-[var(--border)] bg-[var(--surface-elevated)]/40 p-3">
          <button
            type="button"
            onClick={() => setRenovationsOpen((prev) => !prev)}
            className="flex w-full items-center justify-between text-left text-xs font-medium text-[var(--text-primary)]"
          >
            <span>
              Sanierungen{renovations.length > 0 ? ` (${renovations.length})` : ""}
            </span>
            <span className="text-[var(--text-secondary)]">
              {renovationsOpen ? "Einklappen" : "Aufklappen"}
            </span>
          </button>

          {renovationsOpen ? (
            <div className="space-y-2 pt-1">
              {renovations.map((item, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <Input
                    aria-label={`Sanierungsjahr ${idx + 1}`}
                    inputMode="numeric"
                    value={item.year}
                    onChange={(e) =>
                      setRenovations((prev) =>
                        prev.map((row, rIdx) =>
                          rIdx === idx ? { ...row, year: e.target.value } : row,
                        ),
                      )
                    }
                    placeholder="Jahr (z. B. 2021)"
                    disabled={isSubmitting}
                    className="w-28 tabular-nums"
                  />
                  <Select
                    aria-label={`Sanierungsart ${idx + 1}`}
                    value={item.kind}
                    onChange={(e) =>
                      setRenovations((prev) =>
                        prev.map((row, rIdx) =>
                          rIdx === idx
                            ? { ...row, kind: e.target.value as RenovationKind }
                            : row,
                        ),
                      )
                    }
                    disabled={isSubmitting}
                    className="flex-1"
                  >
                    {RENOVATION_KINDS.map((kind) => (
                      <option key={kind} value={kind}>
                        {RENOVATION_KIND_LABELS[kind]}
                      </option>
                    ))}
                  </Select>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      setRenovations((prev) =>
                        prev.filter((_, rIdx) => rIdx !== idx),
                      )
                    }
                    disabled={isSubmitting}
                  >
                    Entfernen
                  </Button>
                </div>
              ))}

              <div className="flex items-center justify-between gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    setRenovations((prev) => [
                      ...prev,
                      { year: "", kind: "roof" },
                    ])
                  }
                  disabled={isSubmitting || renovations.length >= MAX_RENOVATIONS}
                >
                  Sanierung hinzufügen
                </Button>
                <span className="text-2xs text-[var(--text-secondary)]">
                  Max. {MAX_RENOVATIONS} Einträge, kein Freitext
                </span>
              </div>

              {errors.renovations ? (
                <p className="text-xs text-[var(--rose)]">
                  {errors.renovations}
                </p>
              ) : null}
            </div>
          ) : null}
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
            className="flex w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-secondary)]/70 transition-colors outline-hidden focus-visible:ring-[3px] focus-visible:ring-[var(--focus)] disabled:cursor-not-allowed disabled:opacity-50"
          />
          {errors.features ? (
            <p className="text-xs text-[var(--rose)]">{errors.features}</p>
          ) : null}
        </div>
      </div>
    </>
  );
}
