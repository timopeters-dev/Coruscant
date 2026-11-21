import { formatMonthDE } from "@/domain/core/date-format";
import {
  formatAxisCentsDE,
  linearScale,
  niceCentTicks,
} from "@/frontend/charts/chart-scale";
import {
  CHART_DASH_ARRAY,
  CHART_ROLE_COLOR,
} from "@/frontend/charts/chart-tokens";
import type { AdvisorReportViewHistoryRow } from "@/domain/report/view-types";
import { formatEuroDE } from "@/domain/core/money";

interface PrintLineChartProps {
  rows: readonly AdvisorReportViewHistoryRow[];
}

const VIEW_WIDTH = 640;
const VIEW_HEIGHT = 220;
const PAD_LEFT = 72;
const PAD_RIGHT = 20;
const PAD_TOP = 16;
const PAD_BOTTOM = 32;

function formatShortMonthLabel(ym: string): string {
  return formatMonthDE(ym);
}

export function PrintLineChart({ rows }: PrintLineChartProps) {
  if (rows.length < 2) {
    return (
      <p className="rounded-lg border border-dashed border-[var(--border-sub)] px-4 py-6 text-center text-xs text-[var(--text-secondary)]">
        Noch zu wenig Verlauf für ein Diagramm.
      </p>
    );
  }

  const values = rows.map((r) => r.netWorthCents);
  const minVal = Math.min(...values);
  const maxVal = Math.max(...values);
  const yTicks = niceCentTicks(minVal, maxVal, 4);
  const yMin = yTicks[0]!;
  const yMax = yTicks[yTicks.length - 1]!;

  const xScale = linearScale(
    [0, rows.length - 1],
    [PAD_LEFT, VIEW_WIDTH - PAD_RIGHT],
  );
  const yScale = linearScale([yMin, yMax], [VIEW_HEIGHT - PAD_BOTTOM, PAD_TOP]);

  const points = rows.map((row, idx) => ({
    x: xScale(idx),
    y: yScale(row.netWorthCents),
    row,
  }));

  const first = rows[0]!;
  const last = rows[rows.length - 1]!;
  const delta = last.netWorthCents - first.netWorthCents;
  const ariaLabel = `Nettovermögen-Verlauf von ${first.monthDisplay} (${formatEuroDE(first.netWorthCents)}) bis ${last.monthDisplay} (${formatEuroDE(last.netWorthCents)}), Veränderung ${formatEuroDE(delta, { showPlusSign: true })}.`;

  // Pick evenly spaced x-axis labels (at most 6) so labels never overlap
  const step = rows.length <= 6 ? 1 : Math.ceil(rows.length / 6);

  return (
    <svg
      viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
      width="100%"
      role="img"
      aria-label={ariaLabel}
      className="h-auto w-full select-none"
    >
      {/* Horizontal grid & Y labels */}
      {yTicks.map((tick) => {
        const y = yScale(tick);
        return (
          <g key={tick}>
            <line
              x1={PAD_LEFT}
              x2={VIEW_WIDTH - PAD_RIGHT}
              y1={y}
              y2={y}
              stroke={CHART_ROLE_COLOR.grid}
              strokeWidth={1}
            />
            <text
              x={PAD_LEFT - 8}
              y={y + 4}
              textAnchor="end"
              fontSize={10}
              fill={CHART_ROLE_COLOR.axisText}
              className="tabular-nums"
            >
              {formatAxisCentsDE(tick)}
            </text>
          </g>
        );
      })}

      {/* Line segments (dashed when either endpoint is modeled) */}
      {points.slice(0, -1).map((pt, idx) => {
        const next = points[idx + 1]!;
        const isModeledSegment =
          pt.row.hasModeledValues || next.row.hasModeledValues;
        return (
          <line
            key={`${pt.row.month}-${next.row.month}`}
            x1={pt.x}
            y1={pt.y}
            x2={next.x}
            y2={next.y}
            stroke={CHART_ROLE_COLOR.free}
            strokeWidth={2}
            strokeDasharray={isModeledSegment ? CHART_DASH_ARRAY : undefined}
          />
        );
      })}

      {/* Data points */}
      {points.map((pt) => (
        <circle
          key={pt.row.month}
          cx={pt.x}
          cy={pt.y}
          r={3}
          fill={pt.row.hasModeledValues ? "var(--surface)" : CHART_ROLE_COLOR.free}
          stroke={CHART_ROLE_COLOR.free}
          strokeWidth={1.75}
        />
      ))}

      {/* X labels */}
      {points.map((pt, idx) => {
        const isFirstOrLast = idx === 0 || idx === points.length - 1;
        if (!isFirstOrLast && idx % step !== 0) {
          return null;
        }
        return (
          <text
            key={`x-${pt.row.month}`}
            x={pt.x}
            y={VIEW_HEIGHT - 10}
            textAnchor={
              idx === 0
                ? "start"
                : idx === points.length - 1
                  ? "end"
                  : "middle"
            }
            fontSize={10}
            fill={CHART_ROLE_COLOR.axisText}
            className="tabular-nums"
          >
            {formatShortMonthLabel(pt.row.month)}
          </text>
        );
      })}
    </svg>
  );
}
