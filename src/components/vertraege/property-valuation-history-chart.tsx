"use client";

import { formatIsoDateDE } from "@/components/planung/format";
import type { PropertyValuationHistoryRow } from "@/db/schema";
import { formatCentsDE } from "@/lib/domain/money";
import { VALUATION_CONFIDENCE_LABELS } from "./labels";

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

export function PropertyValuationHistoryChart({
  entries,
}: PropertyValuationHistoryChartProps) {
  if (entries.length === 0) {
    return null;
  }

  if (entries.length === 1) {
    const only = entries[0]!;
    return (
      <div className="space-y-2 border-t border-[var(--border)] pt-3">
        <p className="text-xs text-[var(--text-secondary)] tabular-nums">
          Wertverlauf: 1 Eintrag am {formatIsoDateDE(toDateKey(only.valuedAt))} (
          {formatCentsDE(only.medianCents)})
        </p>
        <HistoryTable entries={entries} />
      </div>
    );
  }

  const timestamps = entries.map((e) => new Date(e.valuedAt).getTime());
  const minT = Math.min(...timestamps);
  const maxT = Math.max(...timestamps);
  const spanT = Math.max(1, maxT - minT);

  const allCents = entries.flatMap((e) => [e.lowerCents, e.upperCents]);
  const minV = Math.min(...allCents);
  const maxV = Math.max(...allCents);
  const spanV = Math.max(1, maxV - minV);

  const innerW = WIDTH - PAD.left - PAD.right;
  const innerH = HEIGHT - PAD.top - PAD.bottom;

  const x = (idx: number) => {
    const t = timestamps[idx] ?? minT;
    if (maxT === minT) {
      return PAD.left + (innerW * idx) / (entries.length - 1);
    }
    return PAD.left + (innerW * (t - minT)) / spanT;
  };
  const y = (cents: number) =>
    PAD.top + innerH - (innerH * (cents - minV)) / spanV;

  const medianPath = entries
    .map((e, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(e.medianCents).toFixed(1)}`)
    .join(" ");

  const upperPoints = entries.map(
    (e, i) => `${x(i).toFixed(1)},${y(e.upperCents).toFixed(1)}`,
  );
  const lowerPoints = [...entries]
    .reverse()
    .map((e, revIdx) => {
      const idx = entries.length - 1 - revIdx;
      return `${x(idx).toFixed(1)},${y(e.lowerCents).toFixed(1)}`;
    });
  const bandPath = `M${upperPoints.join(" L")} L${lowerPoints.join(" L")} Z`;

  const first = entries[0]!;
  const last = entries[entries.length - 1]!;
  const ariaLabel = `Wertverlauf von ${formatIsoDateDE(toDateKey(first.valuedAt))} (${formatCentsDE(first.medianCents)}) bis ${formatIsoDateDE(toDateKey(last.valuedAt))} (${formatCentsDE(last.medianCents)}).`;

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
        <path
          d={medianPath}
          fill="none"
          stroke="var(--sky)"
          strokeWidth={2}
        />
        {entries.map((entry, idx) => {
          const cx = x(idx);
          const cy = y(entry.medianCents);
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
          {formatIsoDateDE(toDateKey(first.valuedAt))}
        </text>
        <text
          x={WIDTH - PAD.right}
          y={HEIGHT - 6}
          textAnchor="end"
          fontSize={11}
          fill="var(--text-secondary)"
          className="tabular-nums"
        >
          {formatIsoDateDE(toDateKey(last.valuedAt))}
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
              <th className="px-2 py-1.5 font-medium">Konfidenz</th>
              <th className="px-2 py-1.5 font-medium">Quelle</th>
              <th className="px-2 py-1.5 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {[...entries].reverse().map((entry) => (
              <tr key={entry.id} className="border-t border-[var(--border)]">
                <td className="px-2 py-1.5">
                  {formatIsoDateDE(toDateKey(entry.valuedAt))}
                </td>
                <td className="px-2 py-1.5 text-[var(--text-secondary)]">
                  {entry.source === "manual"
                    ? "–"
                    : `${formatCentsDE(entry.lowerCents)} – ${formatCentsDE(entry.upperCents)}`}
                </td>
                <td className="px-2 py-1.5 text-right font-medium">
                  {formatCentsDE(entry.medianCents)}
                </td>
                <td className="px-2 py-1.5">
                  {entry.confidence
                    ? VALUATION_CONFIDENCE_LABELS[entry.confidence]
                    : "–"}
                </td>
                <td className="px-2 py-1.5">
                  {entry.source === "manual"
                    ? "Manuell"
                    : entry.trigger === "auto"
                      ? "ImmoAnalyse (Auto)"
                      : "ImmoAnalyse (Manuell)"}
                </td>
                <td className="px-2 py-1.5 text-[var(--text-secondary)]">
                  {entry.appliedAt !== null
                    ? entry.previousValueCents !== null
                      ? `übernommen (Vorwert ${formatCentsDE(entry.previousValueCents)})`
                      : "übernommen"
                    : "Vorschlag"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}
