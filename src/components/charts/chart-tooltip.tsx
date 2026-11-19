"use client";

import { CHART_ROLE_COLOR, type ChartRole } from "./chart-tokens";

export interface ChartTooltipItem {
  label: string;
  value: string;
  role: ChartRole;
  dashed?: boolean;
}

interface ChartTooltipProps {
  title: string;
  items: ChartTooltipItem[];
  extra?: { label: string; value: string } | null;
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

  return (
    <div
      role="status"
      aria-hidden="true"
      style={{ left: `${left}px`, top: "8px" }}
      className="pointer-events-none absolute z-10 w-[210px] rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-xs tabular-nums shadow-sm"
    >
      <p className="mb-1 font-medium text-[var(--text-primary)]">{title}</p>
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
      {extra ? (
        <div className="mt-1.5 flex items-center justify-between gap-2 border-t border-[var(--border)] pt-1.5">
          <span className="text-[var(--text-secondary)]">{extra.label}</span>
          <span className="font-medium text-[var(--text-primary)]">
            {extra.value}
          </span>
        </div>
      ) : null}
    </div>
  );
}
