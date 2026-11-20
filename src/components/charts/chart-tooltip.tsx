"use client";

import { CHART_ROLE_COLOR, type ChartRole } from "./chart-tokens";

export interface ChartTooltipItem {
  label: string;
  value: string;
  role: ChartRole;
  dashed?: boolean;
}

export interface ChartTooltipExtra {
  label: string;
  value: string;
}

interface ChartTooltipProps {
  title: string;
  items: ChartTooltipItem[];
  extra?: ChartTooltipExtra | ChartTooltipExtra[] | null;
  xPx: number;
  containerWidth: number;
}

const TOOLTIP_WIDTH_ESTIMATE = 210;

export function ChartTooltip({
  title,
  items,
  extra,
  xPx,
  containerWidth,
}: ChartTooltipProps) {
  const maxLeft = Math.max(4, containerWidth - TOOLTIP_WIDTH_ESTIMATE - 4);
  const preferredLeft = xPx + 12;
  const flippedLeft = xPx - TOOLTIP_WIDTH_ESTIMATE - 12;
  const left =
    preferredLeft <= maxLeft
      ? Math.max(4, preferredLeft)
      : Math.max(4, Math.min(maxLeft, flippedLeft));

  const extraRows: ChartTooltipExtra[] = Array.isArray(extra)
    ? extra
    : extra
      ? [extra]
      : [];

  return (
    <div
      role="status"
      aria-hidden="true"
      style={{
        left: `${left}px`,
        top: "8px",
        transition: "left 160ms cubic-bezier(0.16, 1, 0.3, 1)",
      }}
      className="animate-fade pointer-events-none absolute z-10 w-[210px] rounded-xl border border-[var(--border)] bg-[var(--surface-overlay)] px-3 py-2.5 text-xs tabular-nums shadow-[var(--shadow-md)] backdrop-blur-xl"
    >
      <p className="mb-1.5 font-semibold text-[var(--text-primary)]">{title}</p>
      <ul className="flex flex-col gap-1">
        {items.map((item) => (
          <li key={item.label} className="flex items-center justify-between gap-2">
            <span className="flex min-w-0 items-center gap-1.5 text-[var(--text-secondary)]">
              <span
                className={`inline-block w-3 shrink-0 border-t-2 ${
                  item.dashed ? "border-dashed" : "border-solid"
                }`}
                style={{ borderColor: CHART_ROLE_COLOR[item.role] }}
              />
              <span className="truncate">{item.label}</span>
            </span>
            <span className="shrink-0 font-medium text-[var(--text-primary)]">
              {item.value}
            </span>
          </li>
        ))}
      </ul>
      {extraRows.map((row, idx) => (
        <div
          key={`${row.label}-${idx}`}
          className={`flex items-center justify-between gap-2 ${
            idx === 0
              ? "mt-1.5 border-t border-[var(--border)] pt-1.5"
              : "mt-1"
          }`}
        >
          <span className="text-[var(--text-secondary)]">{row.label}</span>
          <span className="text-right font-medium text-[var(--text-primary)]">
            {row.value}
          </span>
        </div>
      ))}
    </div>
  );
}
