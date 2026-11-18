"use client";

import { formatIsoDateDE } from "@/components/planung/format";
import type { PropertyValuationHistoryRow } from "@/db/schema";
import { formatBpsDE, formatCentsDE } from "@/lib/domain/money";
import {
  applyValuationAdjustmentToBounds,
  formatAdjustmentSummary,
  parseValuationAdjustments,
} from "@/lib/domain/property-valuation-adjustments";
import {
  VALUATION_CONFIDENCE_LABELS,
  VALUATION_TRIGGER_LABELS,
} from "./labels";

interface PropertyValuationHistoryChartProps {
  entries: readonly PropertyValuationHistoryRow[];
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
        <HistoryTable entries={entries} />
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

      <HistoryTable entries={entries} />
    </div>
  );
}

function HistoryTable({
  entries,
}: {
  entries: readonly PropertyValuationHistoryRow[];
}) {
  return (
    <details className="text-xs">
      <summary className="cursor-pointer font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)]">
        Verlaufstabelle anzeigen ({entries.length})
      </summary>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full text-left text-xs tabular-nums">
          <thead>
            <tr className="bg-[var(--surface-elevated)] text-[var(--text-secondary)]">
              <th className="px-2 py-1.5 font-medium">Datum</th>
              <th className="px-2 py-1.5 font-medium">Spanne</th>
              <th className="px-2 py-1.5 text-right font-medium">Median</th>
              <th className="px-2 py-1.5 text-right font-medium">Korrektur</th>
              <th className="px-2 py-1.5 font-medium">Konfidenz</th>
              <th className="px-2 py-1.5 font-medium">Quelle</th>
              <th className="px-2 py-1.5 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
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
              return (
                <tr key={entry.id} className="border-t border-[var(--border)]">
                  <td className="px-2 py-1.5">
                    {formatIsoDateDE(toDateKey(entry.valuedAt))}
                  </td>
                  <td className="px-2 py-1.5 text-[var(--text-secondary)]">
                    {entry.source === "manual"
                      ? "–"
                      : `${formatCentsDE(adjusted.lowerCents)} – ${formatCentsDE(adjusted.upperCents)}`}
                  </td>
                  <td className="px-2 py-1.5 text-right font-medium">
                    {formatCentsDE(pointCents)}
                  </td>
                  <td
                    className="px-2 py-1.5 text-right text-[var(--text-secondary)]"
                    title={adjTooltip || undefined}
                  >
                    {entry.adjustmentBps === 0
                      ? "–"
                      : `${entry.adjustmentBps > 0 ? "+" : ""}${formatBpsDE(entry.adjustmentBps)}`}
                  </td>
                  <td className="px-2 py-1.5">
                    {entry.confidence
                      ? VALUATION_CONFIDENCE_LABELS[entry.confidence]
                      : "–"}
                  </td>
                  <td className="px-2 py-1.5">
                    {entry.source === "manual"
                      ? "Manuell"
                      : VALUATION_TRIGGER_LABELS[entry.trigger]}
                  </td>
                  <td className="px-2 py-1.5 text-[var(--text-secondary)]">
                    {entry.appliedAt !== null
                      ? entry.previousValueCents !== null
                        ? `übernommen (Vorwert ${formatCentsDE(entry.previousValueCents)})`
                        : "übernommen"
                      : "Vorschlag"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </details>
  );
}
