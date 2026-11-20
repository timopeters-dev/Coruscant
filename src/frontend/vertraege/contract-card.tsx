import { CalendarClock } from "lucide-react";
import type { FinancialContractRow } from "@/backend/db/queries/contracts";
import type { PropertyRow } from "@/backend/db/queries/properties";
import type { ContractOverview } from "@/domain/contracts/amortization-types";
import type { ContractMilestone, ContractProjectionResult } from "@/domain/contracts/contract";
import { formatDateDE } from "@/domain/core/date-format";
import { formatBpsDE, formatCentsDE } from "@/domain/core/money";
import { Sparkline } from "@/frontend/charts/sparkline";
import { Badge } from "@/frontend/ui/badge";
import { Card } from "@/frontend/ui/card";
import { StatusBadge } from "@/frontend/ui/status-badge";
import { formatMonthYearDE, getContractTypeLabel } from "./labels";

const AMBER_BADGE = "border-[var(--amber)]/40 bg-[var(--amber)]/10 text-[var(--amber)]";

const percentOf = (bps: number | null | undefined) => (bps != null ? Math.min(100, Math.round(bps / 100)) : null);

/** Karte eines aktiven Kredits oder Bausparvertrags im Register; Klick öffnet das Detail. */
export function ContractCard({
  contract,
  projection,
  overview,
  linkedProperty,
  nextMilestone,
  onOpen,
}: {
  contract: FinancialContractRow;
  projection: ContractProjectionResult | undefined;
  overview: ContractOverview | undefined;
  linkedProperty: PropertyRow | null;
  nextMilestone: ContractMilestone | undefined;
  onOpen: () => void;
}) {
  const isLoan = contract.category === "loan";
  const isProjected = projection?.isProjected ?? false;
  const balanceCents = projection?.projectedBalanceCents ?? contract.currentBalanceCents;
  const milestoneLabel = nextMilestone
    ? nextMilestone.kind === "milestone"
      ? contract.milestoneLabel?.trim() || "Meilenstein"
      : nextMilestone.label
    : null;
  const progressPct = percentOf(overview?.targetProgressBps);
  const thresholdPct = percentOf(overview?.thresholdBps);

  return (
    <Card
      interactive
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
      className={`cursor-pointer p-5 outline-hidden focus-visible:ring-[3px] focus-visible:ring-[var(--focus)] ${
        isProjected ? "border-dashed border-[var(--border-sub)]" : "border-[var(--border)]"
      }`}
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-base font-semibold tracking-tight text-[var(--text-primary)]">{contract.name}</h3>
            {contract.provider ? <span className="text-xs text-[var(--text-secondary)]">· {contract.provider}</span> : null}
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <Badge variant="outline">{getContractTypeLabel(contract.category, contract.repaymentType)}</Badge>
            {contract.status === "paused" ? <Badge className={AMBER_BADGE}>Pausiert</Badge> : null}
            {isProjected ? (
              <StatusBadge variant="modeled" label="Projiziert" detail={`Geeicht ${formatDateDE(contract.balanceAsOfDate)}`} />
            ) : (
              <StatusBadge variant="calibrated" label="Geeicht" detail={formatDateDE(contract.balanceAsOfDate)} />
            )}
            {overview?.isCalibrationStale ? <Badge className={AMBER_BADGE}>Stand alt</Badge> : null}
          </div>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[var(--text-secondary)]">
            <span>
              Zins: <span className="tabular-nums font-medium text-[var(--text-primary)]">{formatBpsDE(contract.interestRateBps)}</span>
            </span>
            <span>
              Rate:{" "}
              <span className="tabular-nums font-medium text-[var(--text-primary)]">{formatCentsDE(contract.monthlyRateCents)}/Monat</span>
            </span>
            {linkedProperty ? (
              <span>
                Immobilie: <span className="font-medium text-[var(--text-primary)]">{linkedProperty.name}</span>
              </span>
            ) : null}
            {isLoan && nextMilestone && milestoneLabel ? (
              <span className="inline-flex items-center gap-1 text-[var(--amber)]">
                <CalendarClock className="h-3.5 w-3.5" />
                <span>{milestoneLabel}:</span>
                <span className="tabular-nums font-medium">{formatDateDE(nextMilestone.date)}</span>
              </span>
            ) : null}
          </div>
        </div>

        <div className="flex shrink-0 flex-col items-start gap-2 sm:flex-row sm:items-center sm:gap-4">
          <div className="text-left sm:text-right">
            <p className="text-xs text-[var(--text-secondary)]">{isLoan ? "Restschuld" : "Guthaben"}</p>
            <p
              className={`tabular-nums text-lg font-semibold ${isLoan || balanceCents < 0 ? "text-[var(--rose)]" : "text-[var(--sky)]"}`}
            >
              {formatCentsDE(balanceCents)}
            </p>
            {!isLoan && balanceCents < 0 ? (
              <p className="text-2xs text-[var(--text-secondary)]">im Minus durch Abschlussgebühr</p>
            ) : null}
          </div>
          {isLoan && overview ? (
            <div className="flex flex-col items-start sm:items-end">
              <Sparkline values={overview.sparklineCents} role="liabilities" />
              <span className="mt-0.5 tabular-nums text-2xs text-[var(--text-secondary)]">
                {overview.notProjected
                  ? "Pausiert"
                  : overview.paidOffDate
                    ? `schuldenfrei ca. ${formatMonthYearDE(overview.paidOffDate)}`
                    : overview.neverPaysOff
                      ? "nicht absehbar"
                      : overview.lumpSum
                        ? "Endfällig"
                        : ""}
              </span>
            </div>
          ) : null}
          {!isLoan && progressPct !== null ? (
            <div className="w-28 space-y-1">
              <div className="relative h-2 w-full meter overflow-hidden rounded-full bg-[var(--surface-elevated)]">
                <div className="h-full rounded-full bg-[var(--sky)]" style={{ width: `${progressPct}%` }} />
                {thresholdPct !== null ? (
                  <div className="absolute top-0 bottom-0 w-0.5 bg-[var(--amber)]" style={{ left: `${thresholdPct}%` }} />
                ) : null}
              </div>
              <p className="tabular-nums text-2xs text-[var(--text-secondary)]">{progressPct} % vom Ziel</p>
            </div>
          ) : null}
        </div>
      </div>
    </Card>
  );
}
