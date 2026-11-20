"use client";

import * as React from "react";
import { Trash2 } from "lucide-react";
import { formatIsoDateDE } from "@/components/planung/format";
import type { PropertyValuationHistoryRow } from "@/db/schema";
import { formatBpsDE, formatCentsDE } from "@/lib/domain/money";
import {
  applyValuationAdjustmentToBounds,
  formatAdjustmentSummary,
  parseValuationAdjustments,
} from "@/lib/domain/property-valuation-adjustments";
import { Button } from "@/components/ui/button";
import {
  VALUATION_CONFIDENCE_LABELS,
  VALUATION_TRIGGER_LABELS,
} from "./labels";

interface PropertyValuationHistoryChartProps {
  entries: readonly PropertyValuationHistoryRow[];
  /** Löscht einen Verlaufseintrag; wirft bei Fehler (Meldung wird angezeigt). */
  onDeleteEntry?: (historyId: string) => Promise<void>;
}

const WIDTH = 600;
const HEIGHT = 180;
const PAD = { top: 14, right: 16, bottom: 26, left: 16 };

const berlinDateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Berlin",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function toDateKey(valuedAt: string): string {
  return berlinDateFormatter.format(new Date(valuedAt));
}

function pickAppliedChoiceCents(
  bounds: { lowerCents: number; medianCents: number; upperCents: number },
  choice: "lower" | "median" | "upper" | null,
): number {
  switch (choice ?? "median") {
    case "lower":
      return bounds.lowerCents;
    case "upper":
      return bounds.upperCents;
    case "median":
      return bounds.medianCents;
  }
}

export function PropertyValuationHistoryChart({
  entries,
  onDeleteEntry,
}: PropertyValuationHistoryChartProps) {
  if (entries.length === 0) {
    return null;
  }

  const computed = entries.map((entry) => {
    const adjusted = applyValuationAdjustmentToBounds(
      {
        lowerCents: entry.lowerCents,
        medianCents: entry.medianCents,
        upperCents: entry.upperCents,
      },
      entry.adjustmentBps,
    );
    const pointCents =
      entry.appliedAt !== null
        ? pickAppliedChoiceCents(adjusted, entry.appliedChoice)
        : adjusted.medianCents;
    const basePointCents =
      entry.appliedAt !== null
        ? pickAppliedChoiceCents(entry, entry.appliedChoice)
        : entry.medianCents;
    return {
      entry,
      adjustedLowerCents: adjusted.lowerCents,
      adjustedMedianCents: adjusted.medianCents,
      adjustedUpperCents: adjusted.upperCents,
      pointCents,
      basePointCents,
    };
  });

  if (computed.length === 1) {
    const only = computed[0]!;
    return (
      <div className="space-y-2 border-t border-[var(--border)] pt-3">
        <p className="text-xs text-[var(--text-secondary)] tabular-nums">
          Wertverlauf: 1 Eintrag am{" "}
          {formatIsoDateDE(toDateKey(only.entry.valuedAt))} (
          {formatCentsDE(only.pointCents)})
        </p>
        <HistoryList entries={entries} onDeleteEntry={onDeleteEntry} />
      </div>
    );
  }

  const hasAnyAdjustment = computed.some((c) => c.entry.adjustmentBps !== 0);

  const timestamps = computed.map((c) => new Date(c.entry.valuedAt).getTime());
  const minT = Math.min(...timestamps);
  const maxT = Math.max(...timestamps);
  const spanT = Math.max(1, maxT - minT);

  const allCents = computed.flatMap((c) =>
    hasAnyAdjustment
      ? [c.adjustedLowerCents, c.adjustedUpperCents, c.basePointCents]
      : [c.adjustedLowerCents, c.adjustedUpperCents],
  );
  const minV = Math.min(...allCents);
  const maxV = Math.max(...allCents);
  const spanV = Math.max(1, maxV - minV);

  const innerW = WIDTH - PAD.left - PAD.right;
  const innerH = HEIGHT - PAD.top - PAD.bottom;

  const x = (idx: number) => {
    const t = timestamps[idx] ?? minT;
    if (maxT === minT) {
      return PAD.left + (innerW * idx) / (computed.length - 1);
    }
    return PAD.left + (innerW * (t - minT)) / spanT;
  };
  const y = (cents: number) =>
    PAD.top + innerH - (innerH * (cents - minV)) / spanV;

  const medianPath = computed
    .map(
      (c, i) =>
        `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(c.pointCents).toFixed(1)}`,
    )
    .join(" ");

  const baseMedianPath = hasAnyAdjustment
    ? computed
        .map(
          (c, i) =>
            `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(c.basePointCents).toFixed(1)}`,
        )
        .join(" ")
    : null;

  const upperPoints = computed.map(
    (c, i) => `${x(i).toFixed(1)},${y(c.adjustedUpperCents).toFixed(1)}`,
  );
  const lowerPoints = [...computed]
    .reverse()
    .map((c, revIdx) => {
      const idx = computed.length - 1 - revIdx;
      return `${x(idx).toFixed(1)},${y(c.adjustedLowerCents).toFixed(1)}`;
    });
  const bandPath = `M${upperPoints.join(" L")} L${lowerPoints.join(" L")} Z`;

  const first = computed[0]!;
  const last = computed[computed.length - 1]!;
  const ariaLabel = `Wertverlauf von ${formatIsoDateDE(toDateKey(first.entry.valuedAt))} (${formatCentsDE(first.pointCents)}) bis ${formatIsoDateDE(toDateKey(last.entry.valuedAt))} (${formatCentsDE(last.pointCents)}).`;

  return (
    <div className="space-y-3 border-t border-[var(--border)] pt-3">
      <div className="flex items-center justify-between text-xs text-[var(--text-secondary)]">
        <span>Wertverlauf</span>
        <span className="tabular-nums">
          {formatCentsDE(minV)} – {formatCentsDE(maxV)}
        </span>
      </div>

      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        role="img"
        aria-label={ariaLabel}
        className="h-auto w-full"
      >
        <path d={bandPath} fill="var(--sky)" fillOpacity={0.14} />
        {baseMedianPath && (
          <path
            d={baseMedianPath}
            fill="none"
            stroke="var(--text-secondary)"
            strokeOpacity={0.55}
            strokeWidth={1.25}
            strokeDasharray="4 3"
          />
        )}
        <path
          d={medianPath}
          fill="none"
          stroke="var(--sky)"
          strokeWidth={2}
        />
        {computed.map(({ entry, pointCents }, idx) => {
          const cx = x(idx);
          const cy = y(pointCents);
          if (entry.trigger === "adjustment") {
            const r = 4.5;
            const points = `${cx},${cy - r} ${cx + r},${cy} ${cx},${cy + r} ${cx - r},${cy}`;
            return (
              <polygon
                key={entry.id}
                points={points}
                fill="var(--accent)"
                stroke="var(--surface)"
                strokeWidth={1.5}
              />
            );
          }
          if (entry.source === "manual") {
            return (
              <circle
                key={entry.id}
                cx={cx}
                cy={cy}
                r={4}
                fill="var(--text-primary)"
              />
            );
          }
          if (entry.appliedAt !== null) {
            return (
              <circle
                key={entry.id}
                cx={cx}
                cy={cy}
                r={4.5}
                fill="var(--emerald)"
                stroke="var(--surface)"
                strokeWidth={1.5}
              />
            );
          }
          return (
            <circle
              key={entry.id}
              cx={cx}
              cy={cy}
              r={3}
              fill="var(--surface)"
              stroke="var(--sky)"
              strokeWidth={1.5}
            />
          );
        })}

        <text
          x={PAD.left}
          y={HEIGHT - 6}
          textAnchor="start"
          fontSize={11}
          fill="var(--text-secondary)"
          className="tabular-nums"
        >
          {formatIsoDateDE(toDateKey(first.entry.valuedAt))}
        </text>
        <text
          x={WIDTH - PAD.right}
          y={HEIGHT - 6}
          textAnchor="end"
          fontSize={11}
          fill="var(--text-secondary)"
          className="tabular-nums"
        >
          {formatIsoDateDE(toDateKey(last.entry.valuedAt))}
        </text>
      </svg>

      <HistoryList entries={entries} onDeleteEntry={onDeleteEntry} />
    </div>
  );
}

function describeSource(entry: PropertyValuationHistoryRow): string {
  return entry.source === "manual"
    ? "Manuell"
    : VALUATION_TRIGGER_LABELS[entry.trigger];
}

function describeStatus(entry: PropertyValuationHistoryRow): string {
  if (entry.appliedAt === null) {
    return "Vorschlag";
  }
  return entry.previousValueCents !== null
    ? `übernommen (Vorwert ${formatCentsDE(entry.previousValueCents)})`
    : "übernommen";
}

function HistoryList({
  entries,
  onDeleteEntry,
}: {
  entries: readonly PropertyValuationHistoryRow[];
  onDeleteEntry?: (historyId: string) => Promise<void>;
}) {
  const [confirmingId, setConfirmingId] = React.useState<string | null>(null);
  const [deletingId, setDeletingId] = React.useState<string | null>(null);
  const [deleteError, setDeleteError] = React.useState<string | null>(null);

  async function handleConfirmDelete(historyId: string) {
    if (!onDeleteEntry) return;
    setDeletingId(historyId);
    setDeleteError(null);
    try {
      await onDeleteEntry(historyId);
      setConfirmingId(null);
    } catch (error) {
      setDeleteError(
        error instanceof Error && error.message
          ? error.message
          : "Eintrag konnte nicht gelöscht werden.",
      );
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <details className="text-xs">
      <summary className="cursor-pointer font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)]">
        Verlaufstabelle anzeigen ({entries.length})
      </summary>
      {deleteError ? (
        <p className="mt-2 text-2xs text-[var(--rose)]">{deleteError}</p>
      ) : null}
      <ul className="mt-2 divide-y divide-[var(--border)] rounded-lg border border-[var(--border)]">
        {[...entries].reverse().map((entry) => {
          const adjusted = applyValuationAdjustmentToBounds(
            {
              lowerCents: entry.lowerCents,
              medianCents: entry.medianCents,
              upperCents: entry.upperCents,
            },
            entry.adjustmentBps,
          );
          const pointCents =
            entry.appliedAt !== null
              ? pickAppliedChoiceCents(adjusted, entry.appliedChoice)
              : adjusted.medianCents;
          const adjTooltip = formatAdjustmentSummary(
            parseValuationAdjustments(entry.adjustmentsJson),
          );
          const meta: string[] = [describeSource(entry)];
          if (entry.confidence) {
            meta.push(`Konfidenz ${VALUATION_CONFIDENCE_LABELS[entry.confidence]}`);
          }
          const isConfirming = confirmingId === entry.id;
          const isDeleting = deletingId === entry.id;
          const dateLabel = formatIsoDateDE(toDateKey(entry.valuedAt));

          return (
            <li key={entry.id} className="px-2.5 py-2 tabular-nums">
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1 space-y-0.5">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                    <span className="font-medium text-[var(--text-primary)]">
                      {dateLabel}
                    </span>
                    <span className="font-medium text-[var(--text-primary)]">
                      {formatCentsDE(pointCents)}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3 text-2xs text-[var(--text-secondary)]">
                    <span className="min-w-0">{meta.join(" · ")}</span>
                    {entry.source !== "manual" ? (
                      <span>
                        {formatCentsDE(adjusted.lowerCents)} –{" "}
                        {formatCentsDE(adjusted.upperCents)}
                      </span>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3 text-2xs text-[var(--text-secondary)]">
                    <span className="min-w-0">{describeStatus(entry)}</span>
                    {entry.adjustmentBps !== 0 ? (
                      <span title={adjTooltip || undefined}>
                        Korrektur {entry.adjustmentBps > 0 ? "+" : ""}
                        {formatBpsDE(entry.adjustmentBps)}
                      </span>
                    ) : null}
                  </div>
                </div>
                {onDeleteEntry && !isConfirming ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 shrink-0 hover:text-[var(--rose)]"
                    aria-label={`Eintrag vom ${dateLabel} löschen`}
                    title="Eintrag löschen"
                    disabled={deletingId !== null}
                    onClick={() => {
                      setDeleteError(null);
                      setConfirmingId(entry.id);
                    }}
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                  </Button>
                ) : null}
              </div>
              {isConfirming ? (
                <div className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-md border border-[var(--rose)]/40 bg-[var(--rose)]/10 px-2.5 py-1.5">
                  <span className="text-2xs text-[var(--text-primary)]">
                    Eintrag löschen? Der aktuelle Objektwert bleibt unverändert.
                  </span>
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-7"
                      disabled={isDeleting}
                      onClick={() => setConfirmingId(null)}
                    >
                      Abbrechen
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      className="h-7 bg-[var(--rose)] text-white"
                      disabled={isDeleting}
                      onClick={() => void handleConfirmDelete(entry.id)}
                    >
                      {isDeleting ? "Löscht…" : "Löschen"}
                    </Button>
                  </div>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </details>
  );
}
