"use client";

import * as React from "react";
import {
  formatAxisCentsDE,
  formatWholeEuroDE,
  linearScale,
  nearestIndex,
  niceCentTicks,
  type ChartTick,
} from "./chart-scale";
import { CHART_DASH_ARRAY, CHART_ROLE_COLOR, type ChartRole } from "./chart-tokens";
import { ChartTooltip, type ChartTooltipExtra } from "./chart-tooltip";
import { useElementWidth } from "./use-element-width";

export interface LinePoint {
  x: number;
  y: number;
  gapBefore?: boolean;
}

export interface LineSeries {
  id: string;
  label: string;
  role: ChartRole;
  dashed: boolean;
  points: LinePoint[];
  /** Fläche unter der Linie (Standard: nur wenn genau eine Serie gezeichnet wird). */
  area?: boolean;
}

export interface LineChartMarker {
  x: number;
  label: string;
  role?: ChartRole;
}

export interface LineChartAnchor {
  x: number;
  y: number;
  label: string;
  role: ChartRole;
}

export interface LineChartProps {
  series: LineSeries[];
  xDomain?: [number, number];
  xTicks: ChartTick[];
  xTooltipLabel: (x: number) => string;
  markers?: LineChartMarker[];
  anchors?: LineChartAnchor[];
  height?: number;
  ariaLabel: string;
  tooltipExtra?: (
    values: Record<string, number>,
    x?: number,
  ) => ChartTooltipExtra | ChartTooltipExtra[] | null;
  emptyText?: string;
}

const PAD_TOP = 20;
const PAD_RIGHT = 16;
const PAD_BOTTOM = 28;
const PAD_LEFT = 64;

function splitSegments(points: LinePoint[]): LinePoint[][] {
  const segments: LinePoint[][] = [];
  let current: LinePoint[] = [];
  points.forEach((pt, idx) => {
    if (idx > 0 && pt.gapBefore) {
      if (current.length >= 2) segments.push(current);
      current = [];
    }
    current.push(pt);
  });
  if (current.length >= 2) segments.push(current);
  return segments;
}

export function shouldCloseOnPointerLeave(pointerType: string): boolean {
  return pointerType !== "touch";
}

export function LineChart({
  series,
  xDomain,
  xTicks,
  xTooltipLabel,
  markers = [],
  anchors = [],
  height = 260,
  ariaLabel,
  tooltipExtra,
  emptyText = "Keine Daten für das Diagramm vorhanden.",
}: LineChartProps) {
  const containerElRef = React.useRef<HTMLDivElement | null>(null);
  const [measureRef, width] = useElementWidth(640);
  const setContainerRef = React.useCallback(
    (node: HTMLDivElement | null) => {
      containerElRef.current = node;
      measureRef(node);
    },
    [measureRef],
  );
  const liveId = React.useId();
  const gradientBaseId = `lc-${liveId.replace(/[^A-Za-z0-9_-]/g, "")}`;
  const [activeIndex, setActiveIndex] = React.useState<number | null>(null);

  React.useEffect(() => {
    if (activeIndex === null) return;
    const handleOutsidePointerDown = (e: PointerEvent) => {
      if (
        containerElRef.current &&
        !containerElRef.current.contains(e.target as Node)
      ) {
        setActiveIndex(null);
      }
    };
    document.addEventListener("pointerdown", handleOutsidePointerDown);
    return () => {
      document.removeEventListener("pointerdown", handleOutsidePointerDown);
    };
  }, [activeIndex]);

  const hasEnoughPoints = series.some((s) => s.points.length >= 2);
  if (!hasEnoughPoints) {
    return (
      <div className="rounded-xl border border-dashed border-[var(--border-sub)] bg-[var(--surface-elevated)]/30 px-4 py-10 text-center text-xs text-[var(--text-secondary)]">
        {emptyText}
      </div>
    );
  }

  const allPoints = series.flatMap((s) => s.points);
  const allXs = allPoints.map((p) => p.x);
  const allYs = allPoints.map((p) => p.y);

  const minX = xDomain ? xDomain[0] : Math.min(...allXs);
  const maxX = xDomain ? xDomain[1] : Math.max(...allXs);
  const minY = Math.min(0, ...allYs);
  const maxY = Math.max(0, ...allYs);

  const yTicks = niceCentTicks(minY, maxY, 5);
  const yDomain: [number, number] = [yTicks[0] ?? 0, yTicks[yTicks.length - 1] ?? 100];

  const plotW = Math.max(80, width - PAD_LEFT - PAD_RIGHT);
  const plotH = Math.max(80, height - PAD_TOP - PAD_BOTTOM);

  const xScale = linearScale([minX, maxX], [PAD_LEFT, PAD_LEFT + plotW]);
  const yScale = linearScale(yDomain, [PAD_TOP + plotH, PAD_TOP]);

  const primaryXs = series.find((s) => s.points.length >= 2)?.points.map((p) => p.x) ?? [];

  const drawnSeries = series.filter((s) => s.points.length >= 2);
  const areaSeries = drawnSeries.filter((s) =>
    s.area !== undefined ? s.area : drawnSeries.length === 1,
  );

  const visibleXTicks =
    width < 480 && xTicks.length > 3
      ? xTicks.filter((_, idx) => idx % 2 === 0 || idx === xTicks.length - 1)
      : xTicks;

  const clampedActiveIndex =
    activeIndex !== null && primaryXs.length > 0
      ? Math.min(primaryXs.length - 1, Math.max(0, activeIndex))
      : null;

  const activeX =
    clampedActiveIndex !== null ? (primaryXs[clampedActiveIndex] ?? null) : null;
  const activeXPx = activeX !== null ? xScale(activeX) : null;

  const activeValues: Record<string, number> = {};
  const tooltipItems =
    activeX !== null
      ? series
          .map((s) => {
            const idx = nearestIndex(
              s.points.map((p) => p.x),
              activeX,
            );
            const pt = idx >= 0 ? s.points[idx] : undefined;
            if (!pt) return null;
            activeValues[s.id] = pt.y;
            return {
              id: s.id,
              label: s.label,
              role: s.role,
              dashed: s.dashed,
              y: pt.y,
              x: pt.x,
              value: formatWholeEuroDE(pt.y),
            };
          })
          .filter((item): item is NonNullable<typeof item> => item !== null)
      : [];

  const activeTitle = activeX !== null ? xTooltipLabel(activeX) : "";
  const extraRow =
    activeX !== null && tooltipExtra
      ? tooltipExtra(activeValues, activeX)
      : null;

  const liveAnnouncement =
    activeX !== null && tooltipItems.length > 0
      ? `${activeTitle}: ${tooltipItems.map((i) => `${i.label} ${i.value}`).join(", ")}`
      : "";

  const handlePointer = (clientX: number, target: SVGElement) => {
    if (primaryXs.length === 0) return;
    const rect = target.getBoundingClientRect();
    const localX = clientX - rect.left;
    const domainX =
      minX + ((localX - PAD_LEFT) / plotW) * (maxX - minX);
    const idx = nearestIndex(primaryXs, domainX);
    if (idx >= 0) {
      setActiveIndex(idx);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<SVGSVGElement>) => {
    if (primaryXs.length === 0) return;
    if (e.key === "ArrowRight") {
      e.preventDefault();
      setActiveIndex((prev) =>
        prev === null ? 0 : Math.min(primaryXs.length - 1, prev + 1),
      );
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      setActiveIndex((prev) =>
        prev === null ? primaryXs.length - 1 : Math.max(0, prev - 1),
      );
    } else if (e.key === "Home") {
      e.preventDefault();
      setActiveIndex(0);
    } else if (e.key === "End") {
      e.preventDefault();
      setActiveIndex(primaryXs.length - 1);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setActiveIndex(null);
    }
  };

  return (
    <div ref={setContainerRef} className="relative w-full select-none">
      <svg
        role="img"
        tabIndex={0}
        aria-label={ariaLabel}
        aria-describedby={liveId}
        width={width}
        height={height}
        style={{ touchAction: "pan-y" }}
        className="block overflow-visible rounded-md outline-hidden focus-visible:ring-[3px] focus-visible:ring-[color-mix(in_srgb,var(--accent)_30%,transparent)]"
        onKeyDown={handleKeyDown}
        onBlur={() => setActiveIndex(null)}
        onPointerLeave={(e) => {
          if (shouldCloseOnPointerLeave(e.pointerType)) {
            setActiveIndex(null);
          }
        }}
      >
        <defs>
          <clipPath id={`${gradientBaseId}-reveal`}>
            <rect
              x={0}
              y={0}
              width={width}
              height={height}
              className="chart-reveal"
            />
          </clipPath>
          {areaSeries.map((s) => (
            <linearGradient
              key={s.id}
              id={`${gradientBaseId}-area-${s.id}`}
              x1="0"
              y1="0"
              x2="0"
              y2="1"
            >
              <stop
                offset="0%"
                stopColor={CHART_ROLE_COLOR[s.role]}
                stopOpacity={s.dashed ? 0.1 : 0.18}
              />
              <stop
                offset="100%"
                stopColor={CHART_ROLE_COLOR[s.role]}
                stopOpacity={0}
              />
            </linearGradient>
          ))}
        </defs>

        {/* Horizontal Y grid lines & labels */}
        {yTicks.map((tick) => {
          const y = yScale(tick);
          const isZero = tick === 0;
          return (
            <g key={tick}>
              <line
                x1={PAD_LEFT}
                y1={y}
                x2={PAD_LEFT + plotW}
                y2={y}
                stroke={isZero ? "var(--border-sub)" : CHART_ROLE_COLOR.grid}
                strokeWidth={1}
                shapeRendering="crispEdges"
              />
              <text
                x={PAD_LEFT - 8}
                y={y + 4}
                textAnchor="end"
                fontSize={11}
                fill={CHART_ROLE_COLOR.axisText}
                className="tabular-nums"
              >
                {formatAxisCentsDE(tick)}
              </text>
            </g>
          );
        })}

        {/* Vertical markers */}
        {markers.map((marker) => {
          if (marker.x < minX || marker.x > maxX) return null;
          const x = xScale(marker.x);
          const color = marker.role
            ? CHART_ROLE_COLOR[marker.role]
            : CHART_ROLE_COLOR.axisText;
          return (
            <g key={`${marker.x}-${marker.label}`}>
              <line
                x1={x}
                y1={PAD_TOP}
                x2={x}
                y2={PAD_TOP + plotH}
                stroke={color}
                strokeWidth={1}
                strokeDasharray="3 3"
              />
              <text
                x={Math.min(PAD_LEFT + plotW - 4, Math.max(PAD_LEFT + 4, x))}
                y={PAD_TOP - 6}
                textAnchor={x > PAD_LEFT + plotW * 0.75 ? "end" : "middle"}
                fontSize={10}
                fill={color}
              >
                {marker.label}
              </text>
            </g>
          );
        })}

        {/* Area washes + series paths (revealed left → right on mount) */}
        <g clipPath={`url(#${gradientBaseId}-reveal)`}>
        {areaSeries.map((s) =>
          splitSegments(s.points).map((segment, segIdx) => {
            const baseY = yScale(Math.max(yDomain[0], Math.min(yDomain[1], 0)));
            const pts = [
              `${xScale(segment[0]!.x).toFixed(1)},${baseY.toFixed(1)}`,
              ...segment.map(
                (pt) => `${xScale(pt.x).toFixed(1)},${yScale(pt.y).toFixed(1)}`,
              ),
              `${xScale(segment[segment.length - 1]!.x).toFixed(1)},${baseY.toFixed(1)}`,
            ].join(" ");
            return (
              <polygon
                key={`${s.id}-area-${segIdx}`}
                points={pts}
                fill={`url(#${gradientBaseId}-area-${s.id})`}
                stroke="none"
              />
            );
          }),
        )}
        {series.map((s) => {
          if (s.points.length < 2) return null;
          const d = s.points
            .map(
              (pt, idx) =>
                `${idx === 0 || pt.gapBefore ? "M" : "L"}${xScale(pt.x).toFixed(1)},${yScale(pt.y).toFixed(1)}`,
            )
            .join(" ");
          const isolatedPoints = s.points.filter((pt, idx) => {
            const disconnectedBefore = idx === 0 || Boolean(pt.gapBefore);
            const disconnectedAfter =
              idx === s.points.length - 1 || Boolean(s.points[idx + 1]?.gapBefore);
            return disconnectedBefore && disconnectedAfter;
          });
          return (
            <g key={s.id}>
              <path
                d={d}
                fill="none"
                stroke={CHART_ROLE_COLOR[s.role]}
                strokeWidth={2}
                strokeDasharray={s.dashed ? CHART_DASH_ARRAY : undefined}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              {isolatedPoints.map((pt) => (
                <circle
                  key={`${s.id}-pt-${pt.x}`}
                  cx={xScale(pt.x).toFixed(1)}
                  cy={yScale(pt.y).toFixed(1)}
                  r={2.5}
                  fill={CHART_ROLE_COLOR[s.role]}
                />
              ))}
            </g>
          );
        })}

        </g>

        {/* Solid calibration anchors */}
        {anchors.map((anchor) => {
          if (anchor.x < minX || anchor.x > maxX) return null;
          return (
            <circle
              key={`anchor-${anchor.x}-${anchor.label}`}
              cx={xScale(anchor.x).toFixed(1)}
              cy={yScale(anchor.y).toFixed(1)}
              r={4}
              fill={CHART_ROLE_COLOR[anchor.role]}
              stroke="var(--surface)"
              strokeWidth={1.5}
            >
              <title>{anchor.label}</title>
            </circle>
          );
        })}

        {/* X axis ticks */}
        {visibleXTicks.map((tick, idx) => {
          const x = xScale(tick.x);
          const anchor =
            idx === 0
              ? "start"
              : idx === visibleXTicks.length - 1
                ? "end"
                : "middle";
          return (
            <text
              key={`${tick.x}-${tick.label}`}
              x={x}
              y={PAD_TOP + plotH + 18}
              textAnchor={anchor}
              fontSize={11}
              fill={CHART_ROLE_COLOR.axisText}
              className="tabular-nums"
            >
              {tick.label}
            </text>
          );
        })}

        {/* Active crosshair & dots */}
        {activeXPx !== null ? (
          <g className="pointer-events-none">
            <line
              x1={0}
              y1={PAD_TOP}
              x2={0}
              y2={PAD_TOP + plotH}
              stroke="var(--border-sub)"
              strokeWidth={1}
              style={{
                transform: `translateX(${activeXPx}px)`,
                transition: "transform 140ms cubic-bezier(0.16, 1, 0.3, 1)",
              }}
            />
            {tooltipItems.map((item) => (
              <circle
                key={item.id}
                cx={xScale(item.x)}
                cy={yScale(item.y)}
                r={4.5}
                fill={CHART_ROLE_COLOR[item.role]}
                stroke="var(--surface)"
                strokeWidth={2}
                style={{
                  transition:
                    "cx 140ms cubic-bezier(0.16, 1, 0.3, 1), cy 140ms cubic-bezier(0.16, 1, 0.3, 1)",
                }}
              />
            ))}
          </g>
        ) : null}

        {/* Pointer capture layer */}
        <rect
          x={PAD_LEFT}
          y={PAD_TOP}
          width={plotW}
          height={plotH}
          fill="transparent"
          onPointerMove={(e) => handlePointer(e.clientX, e.currentTarget)}
          onPointerDown={(e) => handlePointer(e.clientX, e.currentTarget)}
        />
      </svg>

      {activeXPx !== null && tooltipItems.length > 0 ? (
        <ChartTooltip
          title={activeTitle}
          items={tooltipItems}
          extra={extraRow}
          xPx={activeXPx}
          containerWidth={width}
        />
      ) : null}

      <p id={liveId} aria-live="polite" className="sr-only">
        {liveAnnouncement}
      </p>
    </div>
  );
}
