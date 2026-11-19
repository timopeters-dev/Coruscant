import * as React from "react";
import { ChartDataTable } from "@/components/charts/chart-data-table";
import { CHART_ROLE_COLOR } from "@/components/charts/chart-tokens";
import { formatEuroDE } from "@/lib/domain/money";
import type { RecommendationItemKind } from "@/lib/domain/recommendation";

export interface AllocationBarSegment {
  ref: string;
  kind: RecommendationItemKind;
  label: string;
  amountCents: number;
}

interface AllocationBarProps {
  segments: readonly AllocationBarSegment[];
  totalCents: number;
  ariaLabel?: string;
}

const COLOR_BY_KIND: Record<RecommendationItemKind, string> = {
  emergency_fund: CHART_ROLE_COLOR.surplus,
  pot_deadline: CHART_ROLE_COLOR.bound,
  loan_prepayment: CHART_ROLE_COLOR.outflow,
  loan_reserve: CHART_ROLE_COLOR.outflow,
  etf: CHART_ROLE_COLOR.pot,
  keep_liquid: CHART_ROLE_COLOR.baseline,
};

function computeWidthsPercent(
  segments: readonly AllocationBarSegment[],
  totalCents: number,
): number[] {
  if (segments.length === 0 || totalCents <= 0) return [];
  const raw = segments.map((s) => (s.amountCents / totalCents) * 100);
  const rounded = raw.map((p) => Math.round(p * 100) / 100);
  const sum = rounded.reduce((a, b) => a + b, 0);
  if (rounded.length > 0 && Math.abs(100 - sum) > 0.001) {
    rounded[rounded.length - 1] =
      Math.round((rounded[rounded.length - 1]! + (100 - sum)) * 100) / 100;
  }
  return rounded;
}

export function AllocationBar({
  segments,
  totalCents,
  ariaLabel = "Empfohlene Aufteilung",
}: AllocationBarProps) {
  const widths = computeWidthsPercent(segments, totalCents);

  if (segments.length === 0 || totalCents <= 0) {
    return null;
  }

  return (
    <div className="flex flex-col gap-3">
      <div
        role="img"
        aria-label={ariaLabel}
        className="flex h-7 w-full overflow-hidden rounded-lg border border-dashed border-[var(--border)] bg-[var(--surface-elevated)]"
      >
        {segments.map((seg, idx) => {
          const pct = widths[idx] ?? 0;
          const pctLabel = Math.round(pct);
          return (
            <div
              key={seg.ref}
              tabIndex={0}
              role="group"
              aria-label={`${seg.label}: ${formatEuroDE(seg.amountCents)} (${pctLabel} %)`}
              style={{
                width: `${pct}%`,
                backgroundColor: COLOR_BY_KIND[seg.kind],
                backgroundImage:
                  "repeating-linear-gradient(135deg, transparent, transparent 6px, rgba(255,255,255,0.14) 6px, rgba(255,255,255,0.14) 10px)",
              }}
              className="h-full min-w-[2px] border-r border-[var(--surface)]/50 last:border-r-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--text-primary)]"
            />
          );
        })}
      </div>

      <ul className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs tabular-nums">
        {segments.map((seg, idx) => {
          const pctLabel = Math.round(widths[idx] ?? 0);
          return (
            <li key={seg.ref} className="inline-flex items-center gap-1.5">
              <span
                aria-hidden="true"
                className="inline-block h-2.5 w-2.5 rounded-sm border border-dashed border-[var(--border)]"
                style={{ backgroundColor: COLOR_BY_KIND[seg.kind] }}
              />
              <span className="font-medium text-[var(--text-primary)]">
                {seg.label}
              </span>
              <span className="text-[var(--text-secondary)]">
                {formatEuroDE(seg.amountCents)} ({pctLabel} %)
              </span>
            </li>
          );
        })}
      </ul>

      <ChartDataTable
        summary="Aufteilung als Tabelle"
        columns={[
          { key: "ref", header: "Posten" },
          { key: "label", header: "Ziel" },
          { key: "amount", header: "Betrag", align: "right" },
          { key: "share", header: "Anteil", align: "right" },
        ]}
        rows={segments.map((seg, idx) => ({
          ref: seg.ref,
          label: seg.label,
          amount: formatEuroDE(seg.amountCents),
          share: `${Math.round(widths[idx] ?? 0)} %`,
        }))}
      />
    </div>
  );
}
