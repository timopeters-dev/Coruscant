"use client";

import { StatusBadge } from "@/frontend/ui/status-badge";
import { formatBpsDE, formatCentsDE } from "@/domain/core/money";
import { type PropertyDetailState } from "./use-property-detail";

/** Mietkennzahlen: Rendite, Cashflow und Warnhinweise. */
export function PropertyRentalMetricsSection({ ws }: { ws: PropertyDetailState }) {
  const { property, rentalMetrics } = ws;
  return (
    <>
      {/* Mietkennzahlen */}

      {rentalMetrics ? (
        <div className="space-y-3 rounded-xl border border-dashed border-[var(--border-sub)] bg-[var(--surface-elevated)]/40 p-4">
          <div className="flex items-center justify-between gap-2">
            <div>
              <p className="section-label text-[var(--text-secondary)]">
                Vermietung
              </p>
              <p className="text-2xs text-[var(--text-secondary)]">
                vor Steuern
              </p>
            </div>
            <StatusBadge variant="modeled" />
          </div>

          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <p className="text-xs text-[var(--text-secondary)]">Kaltmiete</p>
              <p className="tabular-nums font-medium text-[var(--text-primary)]">
                {formatCentsDE(rentalMetrics.monthlyColdRentCents)}
              </p>
            </div>
            <div>
              <p className="text-xs text-[var(--text-secondary)]">
                Nicht umlagefähig
              </p>
              <p className="tabular-nums font-medium text-[var(--text-primary)]">
                {formatCentsDE(rentalMetrics.monthlyNonRecoverableCostsCents)}
              </p>
            </div>
            <div>
              <p className="text-xs text-[var(--text-secondary)]">
                Kredit-Raten
              </p>
              <p className="tabular-nums font-medium text-[var(--text-primary)]">
                {formatCentsDE(rentalMetrics.monthlyLoanRatesCents)}
              </p>
            </div>
            <div>
              <p className="text-xs text-[var(--text-secondary)]">
                Bauspar-Raten
              </p>
              <p className="tabular-nums font-medium text-[var(--text-primary)]">
                {formatCentsDE(rentalMetrics.monthlySavingsRatesCents)}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 border-t border-[var(--border)]/60 pt-3 text-sm">
            <div>
              <p className="text-xs text-[var(--text-secondary)]">
                Netto-Cashflow vor Rücklage
              </p>
              <p
                className={`tabular-nums font-semibold ${
                  rentalMetrics.netCashflowBeforeReserveCents >= 0
                    ? "text-[var(--emerald)]"
                    : "text-[var(--rose)]"
                }`}
              >
                {formatCentsDE(rentalMetrics.netCashflowBeforeReserveCents, {
                  showPlusSign: true,
                })}
              </p>
            </div>
            <div>
              <p className="text-xs text-[var(--text-secondary)]">
                nach Rücklage (
                {formatCentsDE(rentalMetrics.monthlyMaintenanceAllowanceCents)}
                )
              </p>
              <p
                className={`tabular-nums font-semibold ${
                  rentalMetrics.netCashflowAfterReserveCents >= 0
                    ? "text-[var(--emerald)]"
                    : "text-[var(--rose)]"
                }`}
              >
                {formatCentsDE(rentalMetrics.netCashflowAfterReserveCents, {
                  showPlusSign: true,
                })}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 border-t border-[var(--border)]/60 pt-3 text-sm">
            <div>
              <p className="text-xs text-[var(--text-secondary)]">
                Brutto- / Nettorendite
              </p>
              <p className="tabular-nums font-medium text-[var(--text-primary)]">
                {rentalMetrics.grossYieldBps != null
                  ? formatBpsDE(rentalMetrics.grossYieldBps)
                  : "–"}{" "}
                /{" "}
                {rentalMetrics.netYieldBps != null
                  ? formatBpsDE(rentalMetrics.netYieldBps)
                  : "–"}
              </p>
              <p className="text-2xs text-[var(--text-secondary)]">
                auf Kaufpreis, ohne Nebenkosten
              </p>
            </div>
            <div>
              <p className="text-xs text-[var(--text-secondary)]">
                Kapitalbindung (EK im Objekt)
              </p>
              <p className="tabular-nums font-medium text-[var(--text-primary)]">
                {formatCentsDE(rentalMetrics.capitalTiedCents)}
              </p>
            </div>
          </div>

          {property.depreciationBasisCents != null ? (
            <div className="flex items-center justify-between border-t border-[var(--border)]/60 pt-2.5 text-xs">
              <span className="text-[var(--text-secondary)]">
                AfA-Bemessungsgrundlage (Datenfeld)
              </span>
              <span className="tabular-nums font-medium text-[var(--text-primary)]">
                {formatCentsDE(property.depreciationBasisCents)}
              </span>
            </div>
          ) : null}

          {rentalMetrics.warnings.length > 0 ? (
            <div className="space-y-1 border-t border-[var(--border)]/60 pt-2.5 text-xs text-[var(--text-secondary)]">
              {rentalMetrics.warnings.map((warning, idx) => (
                <p key={`${warning.kind}-${idx}`}>
                  {warning.kind === "negative_equity"
                    ? "Hinweis: Restschuld übersteigt den aktuellen Schätzwert (negative Kapitalbindung)."
                    : "Hinweis: Kein Kaufpreis hinterlegt – Rendite nicht berechenbar."}
                </p>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
