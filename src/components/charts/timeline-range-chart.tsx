"use client";

import * as React from "react";
import { linearScale, type ChartTick } from "./chart-scale";
import { CHART_ROLE_COLOR, type ChartRole } from "./chart-tokens";

export interface TimelineRow {
  id: string;
  label: string;
  status: "filled" | "both" | "baseline_only" | "scenario_only" | "none";
  from: number | null;
  to: number | null;
}

export interface TimelineMarker {
  x: number;
  label: string;
  role?: ChartRole;
}

interface TimelineRangeChartProps {
  rows: TimelineRow[];
  xMax: number;
  xTicks: ChartTick[];
  xTooltipLabel: (x: number) => string;
  fromLabel: string;
  toLabel: string;
  markers?: TimelineMarker[];
  ariaLabel: string;
}

function buildRowAriaLabel(
  row: TimelineRow,
  xTooltipLabel: (x: number) => string,
  fromLabel: string,
  toLabel: string,
): string {
  if (row.status === "filled") {
    return `${row.label}: bereits gefüllt`;
  }
  if (row.status === "none") {
    return `${row.label}: nicht im Zeitraum`;
  }
  const fromText = row.from !== null ? xTooltipLabel(row.from) : "nach Zeitraum";
  const toText = row.to !== null ? xTooltipLabel(row.to) : "nach Zeitraum";
  if (row.status === "both" && row.from !== null && row.to !== null) {
    const diff = row.from - row.to;
    if (diff === 0) {
      return `${row.label}: ${toText} (unverändert)`;
    }
    const n = Math.abs(diff);
    const unit = n === 1 ? "Monat" : "Monate";
    return `${row.label}: ${fromLabel} ${fromText}, ${toLabel} ${toText}, ${n} ${unit} ${diff > 0 ? "früher" : "später"}`;
  }
  return `${row.label}: ${fromLabel} ${fromText}, ${toLabel} ${toText}`;
}

export function TimelineRangeChart({
  rows,
  xMax,
  xTicks,
  xTooltipLabel,
  fromLabel,
  toLabel,
  markers = [],
  ariaLabel,
}: TimelineRangeChartProps) {
  const [hoveredId, setHoveredId] = React.useState<string | null>(null);
  const safeMax = Math.max(1, xMax);
  const pct = linearScale([0, safeMax], [0, 100]);

  return (
    <div
      role="region"
      aria-label={ariaLabel}
      className="flex flex-col gap-1 text-xs"
    >
      {/* Markers header if any */}
      {markers.length > 0 ? (
        <div className="flex items-center">
          <div className="w-[40%] shrink-0 pr-3" />
          <div className="relative h-4 flex-1">
            {markers.map((m) => {
              if (m.x < 0 || m.x > safeMax) return null;
              const leftPct = pct(m.x);
              return (
                <span
                  key={`${m.x}-${m.label}`}
                  style={{
                    left: `${leftPct}%`,
                    color: m.role
                      ? CHART_ROLE_COLOR[m.role]
                      : CHART_ROLE_COLOR.axisText,
                  }}
                  className="absolute top-0 -translate-x-1/2 whitespace-nowrap text-[10px] tabular-nums"
                >
                  {m.label}
                </span>
              );
            })}
          </div>
        </div>
      ) : null}

      {/* Rows */}
      <div className="flex flex-col divide-y divide-[var(--border)]">
        {rows.map((row) => {
          const rowAria = buildRowAriaLabel(
            row,
            xTooltipLabel,
            fromLabel,
            toLabel,
          );
          const showTooltip = hoveredId === row.id;
          const fromPct =
            row.from !== null ? Math.min(100, Math.max(0, pct(row.from))) : null;
          const toPct =
            row.to !== null ? Math.min(100, Math.max(0, pct(row.to))) : null;

          return (
            <div
              key={row.id}
              tabIndex={0}
              aria-label={rowAria}
              onMouseEnter={() => setHoveredId(row.id)}
              onMouseLeave={() => setHoveredId((prev) => (prev === row.id ? null : prev))}
              onFocus={() => setHoveredId(row.id)}
              onBlur={() => setHoveredId((prev) => (prev === row.id ? null : prev))}
              className="relative flex min-h-[32px] items-center rounded px-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
            >
              <span
                title={row.label}
                className="w-[40%] shrink-0 truncate pr-3 text-xs font-medium text-[var(--text-primary)]"
              >
                {row.label}
              </span>

              <div className="relative flex h-8 flex-1 items-center">
                {/* Base horizontal track */}
                <div className="h-px w-full bg-[var(--border)]" />

                {/* Vertical markers */}
                {markers.map((m) => {
                  if (m.x < 0 || m.x > safeMax) return null;
                  return (
                    <div
                      key={`${m.x}-${m.label}`}
                      aria-hidden="true"
                      style={{
                        left: `${pct(m.x)}%`,
                        borderColor: m.role
                          ? CHART_ROLE_COLOR[m.role]
                          : CHART_ROLE_COLOR.axisText,
                      }}
                      className="pointer-events-none absolute top-0 bottom-0 border-l border-dashed opacity-50"
                    />
                  );
                })}

                {row.status === "filled" ? (
                  <span className="absolute left-0 rounded bg-[var(--surface)] pr-2 text-xs font-medium text-[var(--emerald)]">
                    bereits gefüllt
                  </span>
                ) : row.status === "none" ? (
                  <span className="absolute left-0 rounded bg-[var(--surface)] pr-2 text-xs text-[var(--text-secondary)]">
                    nicht im Zeitraum
                  </span>
                ) : (
                  <>
                    {/* Dashed connector line */}
                    {fromPct !== null && toPct !== null && fromPct !== toPct ? (
                      <div
                        aria-hidden="true"
                        style={{
                          left: `${Math.min(fromPct, toPct)}%`,
                          width: `${Math.abs(toPct - fromPct)}%`,
                        }}
                        className="absolute top-1/2 -translate-y-1/2 border-t-2 border-dashed border-[var(--border-sub)]"
                      />
                    ) : null}

                    {/* Connector to right edge when one end is missing */}
                    {row.status === "baseline_only" && fromPct !== null ? (
                      <div
                        aria-hidden="true"
                        style={{ left: `${fromPct}%`, width: `${100 - fromPct}%` }}
                        className="absolute top-1/2 -translate-y-1/2 border-t-2 border-dashed border-[var(--border-sub)]"
                      />
                    ) : null}
                    {row.status === "scenario_only" && toPct !== null ? (
                      <div
                        aria-hidden="true"
                        style={{ left: `${toPct}%`, width: `${100 - toPct}%` }}
                        className="absolute top-1/2 -translate-y-1/2 border-t-2 border-dashed border-[var(--border-sub)]"
                      />
                    ) : null}

                    {/* Hollow baseline circle (omitted if both equal) */}
                    {fromPct !== null &&
                    (row.status !== "both" || row.from !== row.to) ? (
                      <span
                        data-point="baseline"
                        aria-hidden="true"
                        style={{
                          left: `${fromPct}%`,
                          borderColor: CHART_ROLE_COLOR.baseline,
                        }}
                        className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 bg-[var(--surface)]"
                      />
                    ) : null}

                    {/* Filled scenario circle */}
                    {toPct !== null ? (
                      <span
                        data-point="scenario"
                        aria-hidden="true"
                        style={{
                          left: `${toPct}%`,
                          backgroundColor: CHART_ROLE_COLOR.scenario,
                        }}
                        className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full"
                      />
                    ) : null}

                    {/* Right-edge arrow for out-of-range side */}
                    {row.status === "baseline_only" ||
                    row.status === "scenario_only" ? (
                      <span
                        aria-hidden="true"
                        className="absolute right-0 top-1/2 -translate-y-1/2 bg-[var(--surface)] pl-0.5 text-sm font-semibold text-[var(--text-secondary)]"
                      >
                        ›
                      </span>
                    ) : null}
                  </>
                )}
              </div>

              {showTooltip ? (
                <div
                  role="status"
                  className="pointer-events-none absolute right-2 -top-8 z-10 rounded-md border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1 text-[11px] tabular-nums shadow-sm"
                >
                  {rowAria}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>

      {/* X axis ticks */}
      <div className="mt-1 flex items-center">
        <div className="w-[40%] shrink-0 pr-3" />
        <div className="relative h-4 flex-1 text-[11px] tabular-nums text-[var(--text-secondary)]">
          {xTicks.map((tick, idx) => {
            const leftPct = Math.min(100, Math.max(0, pct(tick.x)));
            const translateClass =
              idx === 0
                ? ""
                : idx === xTicks.length - 1
                  ? "-translate-x-full"
                  : "-translate-x-1/2";
            return (
              <span
                key={`${tick.x}-${tick.label}`}
                style={{ left: `${leftPct}%` }}
                className={`absolute top-0 whitespace-nowrap ${translateClass}`}
              >
                {tick.label}
              </span>
            );
          })}
        </div>
      </div>
    </div>
  );
}
