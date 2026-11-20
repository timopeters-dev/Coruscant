"use client";

import type { FinancialContractRow } from "@/backend/db/queries/contracts";
import type { PropertyRow } from "@/backend/db/queries/properties";
import type { ContractProjectionResult } from "@/domain/contracts/contract";
import { formatBpsDE, formatCentsDE } from "@/domain/core/money";
import type { PropertySummary } from "@/domain/properties/properties";
import type { RentalMetrics } from "@/domain/properties/rental";
import { Badge } from "@/frontend/ui/badge";
import { Card } from "@/frontend/ui/card";
import { StatusBadge } from "@/frontend/ui/status-badge";
import { PROPERTY_USAGE_LABELS } from "./labels";

/** Karte einer Immobilie im Register: Wert, Beleihung, Miete und verknüpfte Kredite. */
export function PropertyRegisterCard({
  property,
  summary,
  linked,
  rentalMetrics,
  projectionsById,
  onOpen,
  onOpenContract,
}: {
  property: PropertyRow;
  summary: PropertySummary | undefined;
  linked: FinancialContractRow[];
  rentalMetrics: RentalMetrics | undefined;
  projectionsById: Record<string, ContractProjectionResult>;
  onOpen: () => void;
  onOpenContract: (contractId: string) => void;
}) {
  const isCalibrated = property.purchasePriceCents != null && property.estimatedValueCents === property.purchasePriceCents;
  const ltvPct =
    summary?.ltvBps != null
      ? Math.min(100, Math.round(summary.ltvBps / 100))
      : null;

  return (
    <Card
      interactive
      role="button"
      tabIndex={0}
      onClick={() => onOpen()}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
      className="cursor-pointer p-5 transition-colors hover:border-[var(--border-sub)] hover:bg-[var(--surface-elevated)]/30 outline-hidden focus-visible:ring-[3px] focus-visible:ring-[var(--focus)]"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          {property.imagePath ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={`/api/properties/${property.id}/image?v=${encodeURIComponent(property.updatedAt)}`}
              alt={property.name}
              className="h-14 w-14 shrink-0 rounded-lg border border-[var(--border)] object-cover"
            />
          ) : null}
          <div className="min-w-0 space-y-1">
            <h3 className="truncate text-base font-semibold tracking-tight text-[var(--text-primary)]">
              {property.name}
            </h3>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <Badge variant="secondary">
                {PROPERTY_USAGE_LABELS[property.usage]}
              </Badge>
              {(() => {
                const location = [
                  property.postalCode,
                  property.city,
                ]
                  .filter(Boolean)
                  .join(" ");
                const metaParts = [
                  location,
                  property.livingAreaSqm != null
                    ? `${property.livingAreaSqm} m²`
                    : "",
                ].filter(Boolean);
                if (metaParts.length === 0) return null;
                return (
                  <span className="tabular-nums text-xs text-[var(--text-secondary)]">
                    {metaParts.join(" · ")}
                  </span>
                );
              })()}
            </div>
          </div>
        </div>
        {isCalibrated ? (
          <StatusBadge
            variant="calibrated"
            detail="Kaufpreis"
          />
        ) : (
          <StatusBadge
            variant="modeled"
            detail="Schätzwert"
          />
        )}
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <div
          className={
            isCalibrated
              ? "rounded-lg border border-[var(--border)] bg-[var(--surface-elevated)]/40 p-3"
              : "rounded-lg border border-dashed border-[var(--border-sub)] bg-[var(--surface-elevated)]/40 p-3"
          }
        >
          <p className="text-xs text-[var(--text-secondary)]">
            Geschätzter Wert
          </p>
          <p className="mt-0.5 tabular-nums text-sm font-semibold text-[var(--sky)]">
            {formatCentsDE(property.estimatedValueCents)}
          </p>
        </div>

        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-elevated)]/40 p-3">
          <p className="text-xs text-[var(--text-secondary)]">
            Restschulden
          </p>
          <p className="mt-0.5 tabular-nums text-sm font-semibold text-[var(--rose)]">
            {formatCentsDE(
              summary?.linkedLoanBalanceCents ?? 0,
            )}
          </p>
        </div>

        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-elevated)]/40 p-3">
          <p className="text-xs text-[var(--text-secondary)]">
            Eigenkapital
            {summary?.ltvBps != null ? (
              <>
                {" · LTV "}
                <span className="tabular-nums">
                  {formatBpsDE(summary.ltvBps)}
                </span>
              </>
            ) : null}
          </p>
          <p
            className={`mt-0.5 tabular-nums text-sm font-semibold ${
              (summary?.netEquityCents ?? 0) >= 0
                ? "text-[var(--emerald)]"
                : "text-[var(--rose)]"
            }`}
          >
            {formatCentsDE(
              summary?.netEquityCents ??
                property.estimatedValueCents,
            )}
          </p>
        </div>
      </div>

      {ltvPct !== null ? (
        <div className="mt-3 flex items-center gap-3">
          <div className="h-1.5 flex-1 meter overflow-hidden rounded-full bg-[var(--surface-elevated)]">
            <div
              className="h-full rounded-full bg-[var(--rose)]"
              style={{ width: `${ltvPct}%` }}
            />
          </div>
          <span className="tabular-nums text-2xs text-[var(--text-secondary)]">
            Beleihung {ltvPct} %
          </span>
        </div>
      ) : null}

      {property.usage === "rented"
        ? (() => {
            const rm = rentalMetrics;
            if (!rm) return null;
            return (
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-dashed border-[var(--border-sub)] bg-[var(--surface-elevated)]/30 px-3 py-2 text-xs">
                <span className="tabular-nums text-[var(--text-secondary)]">
                  Miete{" "}
                  <strong className="font-medium text-[var(--text-primary)]">
                    {formatCentsDE(rm.monthlyColdRentCents)}
                  </strong>{" "}
                  · Cashflow{" "}
                  <strong
                    className={
                      rm.netCashflowBeforeReserveCents >= 0
                        ? "font-medium text-[var(--emerald)]"
                        : "font-medium text-[var(--rose)]"
                    }
                  >
                    {formatCentsDE(
                      rm.netCashflowBeforeReserveCents,
                      { showPlusSign: true },
                    )}
                  </strong>
                  /Monat
                </span>
                <StatusBadge variant="modeled" />
              </div>
            );
          })()
        : null}

      {linked.length > 0 ? (
        <div className="mt-4 flex flex-wrap gap-1.5">
          {linked.map((contract) => (
            <button
              key={contract.id}
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onOpenContract(contract.id);
              }}
              onKeyDown={(e) => e.stopPropagation()}
              className="inline-flex items-center gap-1.5 rounded-md border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1 text-xs text-[var(--text-primary)] transition-colors hover:border-[var(--accent)] hover:bg-[var(--surface-elevated)]"
            >
              <span>{contract.name}</span>
              <span
                className={`tabular-nums font-medium ${
                  contract.category === "loan"
                    ? "text-[var(--rose)]"
                    : "text-[var(--sky)]"
                }`}
              >
                {formatCentsDE(
                  projectionsById[contract.id]
                    ?.projectedBalanceCents ??
                    contract.currentBalanceCents,
                )}
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </Card>
  );
}
