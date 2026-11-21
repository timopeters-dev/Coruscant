"use client";

import { Input } from "@/frontend/ui/input";
import { TextField } from "@/frontend/ui/field";
import { Label } from "@/frontend/ui/label";
import { StatusBadge } from "@/frontend/ui/status-badge";
import { type PropertyFormState } from "./use-property-form";

/** Mietprofil (nur bei vermieteten Objekten). */
export function PropertyRentalSection({ ws }: { ws: PropertyFormState }) {
  const {
    depreciationBasisEuro, errors, isSubmitting, monthlyColdRentEuro,
    monthlyMaintenanceAllowanceEuro, monthlyNonRecoverableCostsEuro, setDepreciationBasisEuro,
    setMonthlyColdRentEuro, setMonthlyMaintenanceAllowanceEuro, setMonthlyNonRecoverableCostsEuro,
    usage,
  } = ws;
  return (
    <>
      {/* Gruppe 1b: Vermietung (nur bei usage === 'rented') */}
      {usage === "rented" ? (
        <div className="space-y-4 border-t border-[var(--border)] pt-4">
          <div className="flex items-center justify-between gap-2">
            <p className="section-label text-[var(--text-secondary)]">
              Vermietung
            </p>
            <StatusBadge variant="modeled" />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <TextField
              id="property-cold-rent"
              label="Kaltmiete / Monat in €"
              value={monthlyColdRentEuro}
              onValueChange={setMonthlyColdRentEuro}
              error={errors.monthlyColdRentEuro}
              numeric="decimal"
              placeholder="z. B. 800,00"
              disabled={isSubmitting}
            />

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
              <p className="text-2xs text-[var(--text-secondary)]">
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
    </>
  );
}
