"use client";

import { formatDateDE } from "@/lib/domain/date-format";
import * as React from "react";
import {
  CalendarClock,
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
import type { DocumentRow } from "@/db/queries/documents";
import { formatWholeEuroDE } from "@/components/charts/chart-scale";
import {
  contractRecordToDomain,
  type ContractProjectionResult,
  type ContractStatus,
  getCalibrationAge,
} from "@/lib/domain/contracts";
import {
  getLoanOptions,
  remainingSpecialRepaymentCents,
  repaymentBpsFromRate,
  resolveRateCorridor,
  type RateChangeScope,
} from "@/lib/domain/loan-options";
import { formatBpsDE, formatCentsDE } from "@/lib/domain/money";
import { CalibrationStaleNotice } from "./calibration-stale-notice";
import {
  CONTRACT_STATUS_LABELS,
  getContractTypeLabel,
} from "./labels";
import { LinkedDocumentsSection } from "./linked-documents-section";
import { LoanAmortizationSection } from "./loan-amortization-section";
import { SavingsProgressSection } from "./savings-progress-section";

interface ContractDetailDrawerProps {
  contract: FinancialContractRow | null;
  projection: ContractProjectionResult | null;
  linkedProperty: PropertyRow | null;
  linkedDocuments: DocumentRow[];
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

const RATE_CHANGE_SCOPE_LABELS: Record<RateChangeScope, string> = {
  term: "Laufzeit",
  fixed_period: "je Zinsbindung",
  per_year: "pro Jahr",
};

function ContractDetailDrawerInner({
  contract,
  projection,
  linkedProperty,
  linkedDocuments,
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
  const calibrationAge = getCalibrationAge(contract, asOfDate);
  const typeLabel = getContractTypeLabel(
    contract.category,
    contract.repaymentType,
  );

  const loanOptionsView = React.useMemo(() => {
    if (!isLoan) return null;
    const domain = contractRecordToDomain(contract);
    const options = getLoanOptions(domain);
    const allowance = remainingSpecialRepaymentCents(domain, asOfDate);
    const corridor = resolveRateCorridor(domain, asOfDate);
    const minEquivBps =
      corridor.status !== "not_applicable" && corridor.minMonthlyCents !== null
        ? (corridor.minRepaymentBps ??
          repaymentBpsFromRate(domain, corridor.minMonthlyCents)?.bps ??
          null)
        : null;
    const maxEquivBps =
      corridor.status !== "not_applicable" && corridor.maxMonthlyCents !== null
        ? (corridor.maxRepaymentBps ??
          repaymentBpsFromRate(domain, corridor.maxMonthlyCents)?.bps ??
          null)
        : null;
    return { options, allowance, corridor, minEquivBps, maxEquivBps };
  }, [isLoan, contract, asOfDate]);

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
          <Badge variant="outline">
            {CONTRACT_STATUS_LABELS[contract.status]}
          </Badge>
          {projection.isProjected ? (
            <StatusBadge
              variant="modeled"
              label="Projiziert"
              detail={`ab ${formatDateDE(contract.balanceAsOfDate)}`}
            />
          ) : (
            <StatusBadge
              variant="calibrated"
              label="Geeicht"
              detail={formatDateDE(contract.balanceAsOfDate)}
            />
          )}
        </div>

        {contract.status !== "closed" && calibrationAge.isStale ? (
          <CalibrationStaleNotice months={calibrationAge.months} />
        ) : null}

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
                  <span className="tabular-nums">{formatDateDE(asOfDate)}</span>
                </>
              ) : (
                <>
                  Aktueller Stand (
                  <span className="tabular-nums">{formatDateDE(asOfDate)}</span>)
                </>
              )}
            </p>
            <p
              className={`mt-1 tabular-nums text-xl font-semibold ${
                isLoan || projection.projectedBalanceCents < 0
                  ? "text-[var(--rose)]"
                  : "text-[var(--sky)]"
              }`}
            >
              {formatCentsDE(projection.projectedBalanceCents)}
            </p>
            {!isLoan && projection.projectedBalanceCents < 0 ? (
              <p className="mt-0.5 text-[11px] text-[var(--text-secondary)]">
                Im Minus durch die Abschlussgebühr – die Sparraten gleichen das
                zuerst aus, Guthabenzins gibt es erst ab 0 €.
              </p>
            ) : null}
          </div>

          <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)]/40 p-4">
            <p className="text-xs text-[var(--text-secondary)]">
              Letzter geeichter Stand
            </p>
            <p className="mt-1 tabular-nums text-xl font-semibold text-[var(--text-primary)]">
              {formatCentsDE(projection.startingBalanceCents)}
            </p>
            <p className="mt-0.5 tabular-nums text-xs text-[var(--text-secondary)]">
              Stichtag: {formatDateDE(contract.balanceAsOfDate)}
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

        {isLoan && loanOptionsView ? (
          <div className="space-y-2.5 rounded-xl border border-[var(--border)] p-4 text-sm">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--text-secondary)]">
              Vertragsoptionen
            </h3>

            {contract.fixedInterestUntil ? (
              <div className="flex items-center justify-between gap-2">
                <span className="text-[var(--text-secondary)]">
                  Zinsbindung bis
                </span>
                <span className="tabular-nums font-medium text-[var(--amber)]">
                  {formatDateDE(contract.fixedInterestUntil)}
                </span>
              </div>
            ) : null}

            {loanOptionsView.options.originalPrincipalCents != null ? (
              <div className="flex items-center justify-between gap-2">
                <span className="text-[var(--text-secondary)]">
                  Ursprungsbetrag
                </span>
                <span className="tabular-nums font-medium text-[var(--text-primary)]">
                  {formatCentsDE(loanOptionsView.options.originalPrincipalCents)}
                </span>
              </div>
            ) : null}

            {/* Sondertilgung */}
            <div className="space-y-1 border-t border-[var(--border)]/60 pt-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[var(--text-secondary)]">
                  Sondertilgung
                </span>
                <span className="tabular-nums font-medium text-[var(--text-primary)]">
                  {loanOptionsView.allowance.status === "none"
                    ? "Nicht möglich"
                    : loanOptionsView.allowance.status === "unknown"
                      ? "Unbekannt"
                      : loanOptionsView.allowance.capCents !== null
                        ? `${formatWholeEuroDE(loanOptionsView.allowance.capCents)} / Jahr`
                        : "Möglich (Höhe unbekannt)"}
                </span>
              </div>
              {loanOptionsView.allowance.status === "allowed" &&
              loanOptionsView.allowance.remainingCents !== null ? (
                <div className="flex items-center justify-between gap-2 text-xs text-[var(--text-secondary)]">
                  <span>
                    Kontingent {asOfDate.slice(0, 4)}
                    {loanOptionsView.allowance.basis === "percent_original" &&
                    loanOptionsView.allowance.percentBps != null
                      ? ` (${formatBpsDE(loanOptionsView.allowance.percentBps)} Ursprung)`
                      : loanOptionsView.allowance.basis === "percent_balance" &&
                          loanOptionsView.allowance.percentBps != null
                        ? ` (${formatBpsDE(loanOptionsView.allowance.percentBps)} Restschuld)`
                        : ""}
                  </span>
                  <span className="tabular-nums">
                    frei {formatWholeEuroDE(loanOptionsView.allowance.remainingCents)}
                    {loanOptionsView.allowance.usedCents > 0
                      ? ` · genutzt ${formatWholeEuroDE(loanOptionsView.allowance.usedCents)}`
                      : ""}
                  </span>
                </div>
              ) : null}
              {loanOptionsView.allowance.flags.missingOriginalPrincipal ? (
                <p className="text-[11px] text-[var(--amber)]">
                  Höhe unbekannt – Ursprungsbetrag fehlt.
                </p>
              ) : null}
              {loanOptionsView.allowance.flags.usageFromOtherYear ? (
                <p className="text-[11px] text-[var(--text-secondary)]">
                  Genutzte Sondertilgung stammt aus{" "}
                  <span className="tabular-nums">
                    {loanOptionsView.allowance.usedYear}
                  </span>{" "}
                  (nicht auf {asOfDate.slice(0, 4)} angerechnet).
                </p>
              ) : null}
            </div>

            {/* Tilgungssatzwechsel */}
            {loanOptionsView.corridor.status !== "not_applicable" ? (
              <div className="space-y-1 border-t border-[var(--border)]/60 pt-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[var(--text-secondary)]">
                    Tilgungssatzwechsel
                  </span>
                  <span className="tabular-nums font-medium text-[var(--text-primary)]">
                    {loanOptionsView.corridor.status === "none"
                      ? "Nicht möglich"
                      : loanOptionsView.corridor.status === "unknown"
                        ? "Unbekannt"
                        : loanOptionsView.corridor.flags.exhausted
                          ? "Erschöpft"
                          : loanOptionsView.corridor.remainingChanges !== null
                            ? `${loanOptionsView.corridor.remainingChanges} übrig${
                                loanOptionsView.options.rateChangeScope
                                  ? ` (${RATE_CHANGE_SCOPE_LABELS[loanOptionsView.options.rateChangeScope]})`
                                  : ""
                              }`
                            : `Möglich (Anzahl unbekannt${
                                loanOptionsView.options.rateChangeScope
                                  ? `, ${RATE_CHANGE_SCOPE_LABELS[loanOptionsView.options.rateChangeScope]}`
                                  : ""
                              })`}
                  </span>
                </div>
                {loanOptionsView.corridor.status === "allowed" &&
                loanOptionsView.corridor.minMonthlyCents !== null &&
                loanOptionsView.corridor.maxMonthlyCents !== null ? (
                  <div className="flex flex-wrap items-center justify-between gap-1 text-xs text-[var(--text-secondary)]">
                    <span>Korridor</span>
                    <span className="tabular-nums">
                      {formatWholeEuroDE(
                        loanOptionsView.corridor.minMonthlyCents,
                      )}{" "}
                      –{" "}
                      {formatWholeEuroDE(
                        loanOptionsView.corridor.maxMonthlyCents,
                      )}
                      /Monat
                      {loanOptionsView.minEquivBps !== null &&
                      loanOptionsView.maxEquivBps !== null
                        ? ` (${formatBpsDE(loanOptionsView.minEquivBps)} – ${formatBpsDE(loanOptionsView.maxEquivBps)} Tilgung)`
                        : ""}
                    </span>
                  </div>
                ) : null}
                {loanOptionsView.corridor.status === "allowed" &&
                loanOptionsView.corridor.flags.corridorAssumed ? (
                  <p className="text-[11px] text-[var(--amber)]">
                    Korridor angenommen (1–10 % Tilgung).
                  </p>
                ) : null}
                {loanOptionsView.corridor.status === "allowed" &&
                loanOptionsView.corridor.flags.approximatedBase ? (
                  <p className="text-[11px] text-[var(--text-secondary)]">
                    Näherung über aktuelle Restschuld.
                  </p>
                ) : null}
              </div>
            ) : null}

            {/* Notiz */}
            {loanOptionsView.options.loanOptionsNote ? (
              <div className="border-t border-[var(--border)]/60 pt-2">
                <p className="text-[11px] text-[var(--text-secondary)]">
                  Notiz (nur lokal)
                </p>
                <p className="mt-0.5 whitespace-pre-wrap text-xs text-[var(--text-primary)]">
                  {loanOptionsView.options.loanOptionsNote}
                </p>
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

        {isLoan ? (
          <LoanAmortizationSection contract={contract} asOfDate={asOfDate} />
        ) : (
          <SavingsProgressSection
            contract={contract}
            projection={projection}
            asOfDate={asOfDate}
          />
        )}

        {contract.milestoneDate ? (
          <div className="flex items-center justify-between gap-2 rounded-xl border border-[var(--amber)]/35 bg-[var(--amber)]/10 p-4 text-sm">
            <div className="flex items-center gap-2">
              <CalendarClock className="h-4 w-4 text-[var(--amber)]" />
              <span className="font-medium text-[var(--text-primary)]">
                {contract.milestoneLabel ?? "Meilenstein"}
              </span>
            </div>
            <span className="tabular-nums font-semibold text-[var(--amber)]">
              {formatDateDE(contract.milestoneDate)}
            </span>
          </div>
        ) : null}

        <LinkedDocumentsSection
          documents={linkedDocuments}
          emptyText="Noch keine verifizierten Belege verknüpft. Kontoauszüge und Jahresmitteilungen können über die Dokumenten-Inbox hochgeladen und zur Eichung verknüpft werden."
        />

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
