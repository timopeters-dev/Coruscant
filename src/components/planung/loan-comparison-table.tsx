"use client";

import * as React from "react";
import { formatWholeEuroDE } from "@/components/charts/chart-scale";
import { Badge } from "@/components/ui/badge";
import type {
  LoanComparisonRow,
  LoanComparisonVerdict,
} from "@/lib/domain/loan-comparison";
import { formatBpsDE } from "@/lib/domain/money";
import type { BreakEvenResult } from "@/lib/domain/scenarios";
import { cn } from "@/lib/utils";

export interface LoanComparisonTableProps {
  rows: readonly LoanComparisonRow[];
  selectedLoanId: string;
  onSelectLoan: (loanId: string) => void;
}

const VERDICT_META: Record<
  LoanComparisonVerdict,
  { label: string; className: string }
> = {
  loan: {
    label: "Tilgung",
    className:
      "border-[var(--emerald)]/40 bg-[var(--emerald)]/10 text-[var(--emerald)]",
  },
  etf: {
    label: "ETF",
    className: "border-[var(--sky)]/40 bg-[var(--sky)]/10 text-[var(--sky)]",
  },
  close: {
    label: "knapp",
    className:
      "border-[var(--amber)]/40 bg-[var(--amber)]/10 text-[var(--amber)]",
  },
};

function formatBreakEvenLabel(be: BreakEvenResult | null | undefined): string {
  if (!be) return "–";
  if (be.kind === "identical") return "–";
  if (be.kind === "unreachable") return "> 30 %";
  return `${formatBpsDE(be.bps)} p. a.`;
}

function formatAllowanceCell(row: LoanComparisonRow): string {
  const sa = row.specialAllowance;
  if (sa.status === "none") return "Nicht möglich";
  if (sa.status === "unknown") return "Unbekannt";
  if (sa.remainingCents === null) return "Höhe unbekannt";
  return `${formatWholeEuroDE(sa.remainingCents)} frei`;
}

function formatCorridorCell(row: LoanComparisonRow): {
  primary: string;
  secondary: string | null;
} {
  const rc = row.rateCorridor;
  if (rc.status === "not_applicable") {
    return { primary: "Endfällig", secondary: null };
  }
  if (rc.status === "none") {
    return { primary: "Nicht möglich", secondary: null };
  }
  if (rc.status === "unknown") {
    return { primary: "Unbekannt", secondary: null };
  }
  if (rc.flags.exhausted) {
    return { primary: "Erschöpft", secondary: null };
  }
  const primary =
    rc.remainingChanges !== null
      ? `${rc.remainingChanges} übrig`
      : "Möglich (Anzahl offen)";
  const secondary =
    rc.minMonthlyCents !== null && rc.maxMonthlyCents !== null
      ? `${formatWholeEuroDE(rc.minMonthlyCents)}–${formatWholeEuroDE(rc.maxMonthlyCents)}/Mo`
      : null;
  return { primary, secondary };
}

function formatInterestSavedCell(row: LoanComparisonRow): {
  primary: string;
  secondary: string | null;
} {
  if (!row.special) {
    return { primary: "–", secondary: null };
  }
  return {
    primary: formatWholeEuroDE(row.special.interestSavedCents),
    secondary: row.special.probeLimited
      ? `je ${formatWholeEuroDE(row.special.probeCents)}`
      : null,
  };
}

function VerdictBadge({ verdict }: { verdict: LoanComparisonVerdict }) {
  const meta = VERDICT_META[verdict];
  return (
    <Badge variant="outline" className={cn("font-medium", meta.className)}>
      {meta.label}
    </Badge>
  );
}

export function LoanComparisonTable({
  rows,
  selectedLoanId,
  onSelectLoan,
}: LoanComparisonTableProps) {
  const rowRefs = React.useRef<Array<HTMLElement | null>>([]);

  if (rows.length === 0) {
    return null;
  }

  // Single-loan compact header
  if (rows.length === 1) {
    const row = rows[0]!;
    const corridor = formatCorridorCell(row);
    const saved = formatInterestSavedCell(row);
    return (
      <div
        data-testid="loan-comparison-single"
        className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] shadow-[var(--shadow-sm),inset_0_1px_0_0_var(--hairline-highlight)] px-4 py-3"
      >
        <div className="min-w-0">
          <p className="text-sm font-semibold text-[var(--text-primary)]">
            {row.loanName}
          </p>
          <p className="tabular-nums text-xs text-[var(--text-secondary)]">
            Zins {formatBpsDE(row.interestRateBps)} · Restschuld{" "}
            {formatWholeEuroDE(row.projectedBalanceCents)} · Kontingent:{" "}
            {formatAllowanceCell(row)} · Wechsel: {corridor.primary}
            {corridor.secondary ? ` (${corridor.secondary})` : ""}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-right tabular-nums text-xs">
            <p className="text-[var(--text-secondary)]">Break-even</p>
            <p className="font-semibold text-[var(--text-primary)]">
              {formatBreakEvenLabel(
                row.special?.breakEven ?? row.bestBreakEven,
              )}
            </p>
          </div>
          {row.special ? (
            <div className="text-right tabular-nums text-xs">
              <p className="text-[var(--text-secondary)]">
                Ersparnis je 1.000 €
              </p>
              <p className="font-semibold text-[var(--emerald)]">
                {saved.primary}
              </p>
            </div>
          ) : null}
          <VerdictBadge verdict={row.verdict} />
        </div>
      </div>
    );
  }

  const handleKeyDown = (
    idx: number,
    e: React.KeyboardEvent<HTMLElement>,
  ) => {
    let nextIdx: number | null = null;
    if (e.key === "ArrowDown") {
      nextIdx = (idx + 1) % rows.length;
    } else if (e.key === "ArrowUp") {
      nextIdx = (idx - 1 + rows.length) % rows.length;
    } else if (e.key === "Home") {
      nextIdx = 0;
    } else if (e.key === "End") {
      nextIdx = rows.length - 1;
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onSelectLoan(rows[idx]!.loanId);
      return;
    }
    if (nextIdx !== null) {
      e.preventDefault();
      const target = rows[nextIdx]!;
      onSelectLoan(target.loanId);
      rowRefs.current[nextIdx]?.focus();
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--text-secondary)]">
          Kredit-Ranking ({rows.length} aktive Darlehen)
        </h3>
        <span className="text-[11px] text-[var(--text-secondary)]">
          Sortiert nach Break-even-Rendite · Klick oder Pfeiltasten zum Auswählen
        </span>
      </div>

      {/* Desktop table */}
      <div className="hidden overflow-x-auto rounded-xl border border-[var(--border)] bg-[var(--surface)] shadow-[var(--shadow-sm),inset_0_1px_0_0_var(--hairline-highlight)] md:block">
        <table
          aria-label="Vergleich aktiver Darlehen"
          className="w-full border-collapse text-left text-xs"
        >
          <thead>
            <tr className="border-b border-[var(--border)] text-[11px] text-[var(--text-secondary)]">
              <th className="px-3 py-2.5 font-medium">Kredit</th>
              <th className="px-3 py-2.5 text-right font-medium">Zins</th>
              <th className="px-3 py-2.5 text-right font-medium">
                Break-even (Sondertilgung)
              </th>
              <th className="px-3 py-2.5 text-right font-medium">
                Freies Kontingent
              </th>
              <th className="px-3 py-2.5 font-medium">Wechsel &amp; Korridor</th>
              <th className="px-3 py-2.5 text-right font-medium">
                Zinsersparnis je 1.000 €
              </th>
              <th className="px-3 py-2.5 text-right font-medium">Verdikt</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, idx) => {
              const isSelected = row.loanId === selectedLoanId;
              const corridor = formatCorridorCell(row);
              const saved = formatInterestSavedCell(row);
              return (
                <tr
                  key={row.loanId}
                  ref={(el) => {
                    rowRefs.current[idx] = el;
                  }}
                  role="row"
                  aria-selected={isSelected}
                  tabIndex={isSelected ? 0 : -1}
                  onClick={() => onSelectLoan(row.loanId)}
                  onKeyDown={(e) => handleKeyDown(idx, e)}
                  className={cn(
                    "cursor-pointer border-b border-[var(--border)]/60 transition-colors last:border-b-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--accent)]",
                    isSelected
                      ? "bg-[var(--accent)]/10"
                      : "hover:bg-[var(--surface-elevated)]/60",
                  )}
                >
                  <td className="px-3 py-2.5">
                    <p className="font-semibold text-[var(--text-primary)]">
                      {row.loanName}
                    </p>
                    <p className="tabular-nums text-[11px] text-[var(--text-secondary)]">
                      Restschuld {formatWholeEuroDE(row.projectedBalanceCents)}
                    </p>
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums font-medium text-[var(--text-primary)]">
                    {formatBpsDE(row.interestRateBps)}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums font-semibold text-[var(--text-primary)]">
                    {formatBreakEvenLabel(
                      row.special?.breakEven ?? row.bestBreakEven,
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-[var(--text-primary)]">
                    {formatAllowanceCell(row)}
                  </td>
                  <td className="px-3 py-2.5">
                    <p className="tabular-nums text-[var(--text-primary)]">
                      {corridor.primary}
                    </p>
                    {corridor.secondary ? (
                      <p className="tabular-nums text-[11px] text-[var(--text-secondary)]">
                        {corridor.secondary}
                      </p>
                    ) : null}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums">
                    <p className="font-medium text-[var(--emerald)]">
                      {saved.primary}
                    </p>
                    {saved.secondary ? (
                      <p className="text-[11px] text-[var(--text-secondary)]">
                        {saved.secondary}
                      </p>
                    ) : null}
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    <VerdictBadge verdict={row.verdict} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Mobile cards */}
      <div
        role="listbox"
        aria-label="Vergleich aktiver Darlehen"
        className="grid gap-2 md:hidden"
      >
        {rows.map((row, idx) => {
          const isSelected = row.loanId === selectedLoanId;
          return (
            <button
              key={row.loanId}
              type="button"
              role="option"
              aria-selected={isSelected}
              onClick={() => onSelectLoan(row.loanId)}
              onKeyDown={(e) => handleKeyDown(idx, e)}
              className={cn(
                "flex w-full items-center justify-between gap-3 rounded-xl border px-3.5 py-3 text-left transition-colors outline-hidden focus-visible:ring-[3px] focus-visible:ring-[color-mix(in_srgb,var(--accent)_30%,transparent)]",
                isSelected
                  ? "border-[var(--accent)] bg-[var(--accent)]/10"
                  : "border-[var(--border)] bg-[var(--surface)] hover:bg-[var(--surface-elevated)]/60",
              )}
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-[var(--text-primary)]">
                  {row.loanName}
                </p>
                <p className="tabular-nums text-xs text-[var(--text-secondary)]">
                  Zins {formatBpsDE(row.interestRateBps)} · Break-even{" "}
                  {formatBreakEvenLabel(
                    row.special?.breakEven ?? row.bestBreakEven,
                  )}
                </p>
              </div>
              <VerdictBadge verdict={row.verdict} />
            </button>
          );
        })}
      </div>
    </div>
  );
}
