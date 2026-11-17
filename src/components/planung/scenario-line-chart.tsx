import { formatCentsDE } from "@/lib/domain/money";
import type { PrepaymentTimelinePoint } from "@/lib/domain/scenarios";
import { formatIsoDateDE } from "./format";

interface ScenarioLineChartProps {
  timeline: readonly PrepaymentTimelinePoint[];
}

const WIDTH = 640;
const HEIGHT = 240;
const PAD = { top: 12, right: 12, bottom: 24, left: 12 };

function pickYearlyPoints(
  timeline: readonly PrepaymentTimelinePoint[],
): PrepaymentTimelinePoint[] {
  return timeline.filter(
    (p, i) => p.monthIndex % 12 === 0 || i === timeline.length - 1,
  );
}

export function ScenarioLineChart({ timeline }: ScenarioLineChartProps) {
  const points = pickYearlyPoints(timeline);
  if (points.length < 2) {
    return null;
  }

  const values = points.flatMap((p) => [p.netWorthA, p.netWorthB, 0]);
  const minV = Math.min(...values);
  const maxV = Math.max(...values);
  const span = Math.max(1, maxV - minV);
  const innerW = WIDTH - PAD.left - PAD.right;
  const innerH = HEIGHT - PAD.top - PAD.bottom;

  const x = (i: number) => PAD.left + (innerW * i) / (points.length - 1);
  const y = (v: number) => PAD.top + innerH - (innerH * (v - minV)) / span;
  const path = (pick: (p: PrepaymentTimelinePoint) => number) =>
    points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(pick(p)).toFixed(1)}`).join(" ");

  const last = points[points.length - 1]!;
  const label = `Nettoposition über die Zeit: Sondertilgung ${formatCentsDE(last.netWorthA)}, ETF-Ansparung ${formatCentsDE(last.netWorthB)} am ${formatIsoDateDE(last.date)}.`;

  return (
    <div className="flex flex-col gap-3">
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        role="img"
        aria-label={label}
        className="h-auto w-full"
      >
        <line
          x1={PAD.left}
          x2={WIDTH - PAD.right}
          y1={y(0)}
          y2={y(0)}
          stroke="var(--border-sub)"
          strokeWidth={1}
        />
        <path d={path((p) => p.netWorthA)} fill="none" stroke="var(--sky)" strokeWidth={2} strokeDasharray="6 4" />
        <path d={path((p) => p.netWorthB)} fill="none" stroke="var(--accent)" strokeWidth={2} strokeDasharray="6 4" />
        {points.map((p, i) =>
          i % Math.max(1, Math.ceil(points.length / 8)) === 0 || i === points.length - 1 ? (
            <text
              key={p.monthIndex}
              x={x(i)}
              y={HEIGHT - 6}
              textAnchor={i === 0 ? "start" : i === points.length - 1 ? "end" : "middle"}
              fontSize={11}
              fill="var(--text-secondary)"
              className="tabular-nums"
            >
              {p.date.slice(0, 4)}
            </text>
          ) : null,
        )}
      </svg>
      <div className="flex flex-wrap gap-4 text-xs text-[var(--text-secondary)]">
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-0 w-5 border-t-2 border-dashed border-[var(--sky)]" aria-hidden="true" />
          Sondertilgung (Nettoposition)
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-0 w-5 border-t-2 border-dashed border-[var(--accent)]" aria-hidden="true" />
          ETF-Ansparung (Nettoposition)
        </span>
      </div>
      <details className="text-sm">
        <summary className="cursor-pointer text-xs font-medium text-[var(--text-secondary)]">
          Jahreswerte anzeigen
        </summary>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full text-xs tabular-nums">
            <thead>
              <tr className="bg-[var(--surface-elevated)] text-left text-[var(--text-secondary)]">
                <th className="px-2 py-1.5 font-medium">Datum</th>
                <th className="px-2 py-1.5 text-right font-medium">Sondertilgung</th>
                <th className="px-2 py-1.5 text-right font-medium">ETF</th>
              </tr>
            </thead>
            <tbody>
              {points.map((p) => (
                <tr key={p.monthIndex} className="border-t border-[var(--border)]">
                  <td className="px-2 py-1.5">{formatIsoDateDE(p.date)}</td>
                  <td className="px-2 py-1.5 text-right">{formatCentsDE(p.netWorthA)}</td>
                  <td className="px-2 py-1.5 text-right">{formatCentsDE(p.netWorthB)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
