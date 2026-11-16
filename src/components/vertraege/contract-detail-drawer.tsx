"use client";

import * as React from "react";
import {
  CalendarClock,
  FileText,
  Pause,
  Pencil,
  Play,
  Trash2,
  CheckSquare,
} from "lucide-react";
import { StatusBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import type { FinancialContractRow, PropertyRow } from "@/db/queries/contracts";
import type {
  ContractProjectionResult,
  ContractStatus,
} from "@/lib/domain/contracts";
import { formatBpsDE, formatCentsDE } from "@/lib/domain/money";
import {
  CONTRACT_SPHERE_LABELS,
  CONTRACT_STATUS_LABELS,
  getContractTypeLabel,
} from "./labels";

interface ContractDetailDrawerProps {
  contract: FinancialContractRow | null;
  projection: ContractProjectionResult | null;
  linkedProperty: PropertyRow | null;
  asOfDate: string;
  onClose: () => void;
  onEdit: (contract: FinancialContractRow) => void;
  onMutated: () => void;
}

export function ContractDetailDrawer(props: ContractDetailDrawerProps) {
  if (!props.contract || !props.projection) {
    return null;
  }

  return (
    <ContractDetailDrawerInner
      key={props.contract.id}
      {...props}
      contract={props.contract}
      projection={props.projection}
    />
  );
}

function ContractDetailDrawerInner({
  contract,
  projection,
  linkedProperty,
  asOfDate,
  onClose,
  onEdit,
  onMutated,
}: Omit<ContractDetailDrawerProps, "contract" | "projection"> & {
  contract: FinancialContractRow;
  projection: ContractProjectionResult;
}) {
  const [confirmDelete, setConfirmDelete] = React.useState(false);
  const [isMutating, setIsMutating] = React.useState(false);
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);

  const isLoan = contract.category === "loan";
  const typeLabel = getContractTypeLabel(
    contract.category,
    contract.repaymentType,
  );

  async function handleStatusChange(nextStatus: ContractStatus) {
    if (!contract) return;
    setIsMutating(true);
    setErrorMessage(null);

    try {
      const response = await fetch(`/api/contracts/${contract.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: nextStatus }),
      });

      if (!response.ok) {
        const body = (await response.json()) as { error?: string };
        setErrorMessage(body.error ?? "Statusänderung fehlgeschlagen.");
        setIsMutating(false);
        return;
      }

      onClose();
      onMutated();
    } catch {
      setErrorMessage("Netzwerkfehler bei der Statusänderung.");
      setIsMutating(false);
    }
  }

  async function handleDelete() {
    if (!contract) return;
    setIsMutating(true);
    setErrorMessage(null);

    try {
      const response = await fetch(`/api/contracts/${contract.id}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        const body = (await response.json()) as { error?: string };
        setErrorMessage(body.error ?? "Löschen fehlgeschlagen.");
        setIsMutating(false);
        return;
      }

      onClose();
      onMutated();
    } catch {
      setErrorMessage("Netzwerkfehler beim Löschen des Vertrags.");
      setIsMutating(false);
    }
  }

  return (
    <Sheet
      open={Boolean(contract)}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={contract.name}
      subtitle={`${typeLabel}${contract.provider ? ` · ${contract.provider}` : ""}`}
    >
      <div className="space-y-6">
        {errorMessage ? (
          <div className="rounded-lg border border-[var(--rose)]/40 bg-[var(--rose)]/10 px-3 py-2 text-xs text-[var(--rose)]">
            {errorMessage}
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-2">
          <Badge>{CONTRACT_SPHERE_LABELS[contract.sphere]}</Badge>
          <Badge variant="outline">
            {CONTRACT_STATUS_LABELS[contract.status]}
          </Badge>
          {projection.isProjected ? (
            <StatusBadge
              variant="modeled"
              label="Projiziert"
              detail={`ab ${contract.balanceAsOfDate}`}
            />
          ) : (
            <StatusBadge
              variant="calibrated"
              label="Geeicht"
              detail={contract.balanceAsOfDate}
            />
          )}
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div
            className={
              projection.isProjected
                ? "rounded-xl border border-dashed border-[var(--border-sub)] bg-[var(--surface-elevated)]/40 p-4"
                : "rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)]/40 p-4"
            }
          >
            <p className="text-xs text-[var(--text-secondary)]">
              {projection.isProjected ? (
                <>
                  Projiziert per{" "}
                  <span className="tabular-nums">{asOfDate}</span>
                </>
              ) : (
                <>
                  Aktueller Stand (
                  <span className="tabular-nums">{asOfDate}</span>)
                </>
              )}
            </p>
            <p
              className={`mt-1 tabular-nums text-xl font-semibold ${
                isLoan ? "text-[var(--rose)]" : "text-[var(--sky)]"
              }`}
            >
              {formatCentsDE(projection.projectedBalanceCents)}
            </p>
          </div>

          <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)]/40 p-4">
            <p className="text-xs text-[var(--text-secondary)]">
              Letzter geeichter Stand
            </p>
            <p className="mt-1 tabular-nums text-xl font-semibold text-[var(--text-primary)]">
              {formatCentsDE(projection.startingBalanceCents)}
            </p>
            <p className="mt-0.5 tabular-nums text-xs text-[var(--text-secondary)]">
              Stichtag: {contract.balanceAsOfDate}
            </p>
          </div>
        </div>

        <div className="space-y-2 rounded-xl border border-[var(--border)] p-4 text-sm">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[var(--text-secondary)]">Monatsrate</span>
            <span className="tabular-nums font-medium text-[var(--text-primary)]">
              {formatCentsDE(contract.monthlyRateCents)}
            </span>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-[var(--text-secondary)]">Zinssatz</span>
            <span className="tabular-nums font-medium text-[var(--text-primary)]">
              {formatBpsDE(contract.interestRateBps)}
            </span>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-[var(--text-secondary)]">
              Verstrichene Monate
            </span>
            <span className="tabular-nums font-medium text-[var(--text-primary)]">
              {projection.monthsElapsed}
            </span>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-[var(--text-secondary)]">
              Aufgelaufene Zinsen
            </span>
            <span className="tabular-nums font-medium text-[var(--text-primary)]">
              {formatCentsDE(projection.totalInterestAccruedCents)}
            </span>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-[var(--text-secondary)]">
              {isLoan ? "Geleistete Tilgung" : "Geleistete Einzahlungen"}
            </span>
            <span className="tabular-nums font-medium text-[var(--text-primary)]">
              {formatCentsDE(
                isLoan
                  ? projection.totalPrincipalPaidCents
                  : projection.totalContributionsCents,
              )}
            </span>
          </div>
          {linkedProperty ? (
            <div className="flex items-center justify-between gap-2">
              <span className="text-[var(--text-secondary)]">
                Verknüpfte Immobilie
              </span>
              <span className="font-medium text-[var(--text-primary)]">
                {linkedProperty.name}
              </span>
            </div>
          ) : null}
        </div>

        {isLoan &&
        (contract.fixedInterestUntil ||
          contract.specialRepaymentMaxYearlyCents != null) ? (
          <div className="space-y-2 rounded-xl border border-[var(--border)] p-4 text-sm">
            {contract.fixedInterestUntil ? (
              <div className="flex items-center justify-between gap-2">
                <span className="text-[var(--text-secondary)]">
                  Zinsbindung bis
                </span>
                <span className="tabular-nums font-medium text-[var(--amber)]">
                  {contract.fixedInterestUntil}
                </span>
              </div>
            ) : null}
            {contract.specialRepaymentMaxYearlyCents != null ? (
              <div className="flex items-center justify-between gap-2">
                <span className="text-[var(--text-secondary)]">
                  Max. Sondertilgung / Jahr
                </span>
                <span className="tabular-nums font-medium text-[var(--text-primary)]">
                  {formatCentsDE(contract.specialRepaymentMaxYearlyCents)}
                </span>
              </div>
            ) : null}
          </div>
        ) : null}

        {!isLoan &&
        (contract.targetSumCents != null ||
          contract.allocationThresholdPercent != null ||
          contract.futureLoanInterestRateBps != null) ? (
          <div className="space-y-2 rounded-xl border border-[var(--border)] p-4 text-sm">
            {contract.targetSumCents != null ? (
              <div className="flex items-center justify-between gap-2">
                <span className="text-[var(--text-secondary)]">
                  Bausparsumme
                </span>
                <span className="tabular-nums font-medium text-[var(--text-primary)]">
                  {formatCentsDE(contract.targetSumCents)}
                </span>
              </div>
            ) : null}
            {projection.targetProgressBps != null ? (
              <div className="flex items-center justify-between gap-2">
                <span className="text-[var(--text-secondary)]">
                  Anspar-Fortschritt
                </span>
                <span className="tabular-nums font-medium text-[var(--sky)]">
                  {formatBpsDE(projection.targetProgressBps)}
                </span>
              </div>
            ) : null}
            {contract.allocationThresholdPercent != null ? (
              <div className="flex items-center justify-between gap-2">
                <span className="text-[var(--text-secondary)]">
                  Zuteilungsschwelle (
                  <span className="tabular-nums">
                    {contract.allocationThresholdPercent} %
                  </span>
                  )
                </span>
                <span className="font-medium text-[var(--text-primary)]">
                  {projection.isAllocationThresholdReached
                    ? "Erreicht"
                    : "Offen"}
                </span>
              </div>
            ) : null}
            {contract.futureLoanInterestRateBps != null ? (
              <div className="flex items-center justify-between gap-2">
                <span className="text-[var(--text-secondary)]">
                  Späterer Darlehenszins
                </span>
                <span className="tabular-nums font-medium text-[var(--text-primary)]">
                  {formatBpsDE(contract.futureLoanInterestRateBps)}
                </span>
              </div>
            ) : null}
          </div>
        ) : null}

        {contract.milestoneDate ? (
          <div className="flex items-center justify-between gap-2 rounded-xl border border-[var(--amber)]/35 bg-[var(--amber)]/10 p-4 text-sm">
            <div className="flex items-center gap-2">
              <CalendarClock className="h-4 w-4 text-[var(--amber)]" />
              <span className="font-medium text-[var(--text-primary)]">
                {contract.milestoneLabel ?? "Meilenstein"}
              </span>
            </div>
            <span className="tabular-nums font-semibold text-[var(--amber)]">
              {contract.milestoneDate}
            </span>
          </div>
        ) : null}

        <div className="rounded-xl border border-dashed border-[var(--border-sub)] bg-[var(--surface-elevated)]/30 p-4">
          <div className="flex items-center gap-2 text-xs font-medium text-[var(--text-primary)]">
            <FileText className="h-3.5 w-3.5 text-[var(--amber)]" />
            <span>Verknüpfte Belege &amp; Eichung (ab Slice 6)</span>
          </div>
          <p className="mt-1 text-xs text-[var(--text-secondary)]">
            Kontoauszüge und Jahresmitteilungen können ab Slice 6 hochgeladen
            werden, um den Vertragsstand per 1-Klick zu eichen.
          </p>
        </div>

        <div className="space-y-3 border-t border-[var(--border)] pt-4">
          <div className="flex flex-wrap gap-2">
            {contract.status === "active" ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleStatusChange("paused")}
                disabled={isMutating}
              >
                <Pause className="h-3.5 w-3.5" />
                Pausieren
              </Button>
            ) : (
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleStatusChange("active")}
                disabled={isMutating}
              >
                <Play className="h-3.5 w-3.5" />
                Fortsetzen
              </Button>
            )}

            {contract.status !== "closed" ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleStatusChange("closed")}
                disabled={isMutating}
              >
                <CheckSquare className="h-3.5 w-3.5" />
                Beenden
              </Button>
            ) : null}

            <Button
              variant="secondary"
              size="sm"
              onClick={() => onEdit(contract)}
              disabled={isMutating}
            >
              <Pencil className="h-3.5 w-3.5" />
              Bearbeiten
            </Button>

            {!confirmDelete ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setConfirmDelete(true)}
                disabled={isMutating}
                className="text-[var(--rose)] hover:border-[var(--rose)]/50"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Löschen
              </Button>
            ) : null}
          </div>

          {confirmDelete ? (
            <div className="space-y-2 rounded-xl border border-[var(--rose)]/40 bg-[var(--rose)]/10 p-3">
              <p className="text-xs text-[var(--text-primary)]">
                Diesen Vertrag wirklich endgültig löschen?
              </p>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  onClick={handleDelete}
                  disabled={isMutating}
                  className="bg-[var(--rose)] text-white hover:opacity-90"
                >
                  {isMutating ? "Löscht..." : "Endgültig löschen"}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setConfirmDelete(false)}
                  disabled={isMutating}
                >
                  Abbrechen
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </Sheet>
  );
}
