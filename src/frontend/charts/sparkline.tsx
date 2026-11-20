"use client";

import * as React from "react";
import { linearScale } from "./chart-scale";
import { CHART_DASH_ARRAY, CHART_ROLE_COLOR, type ChartRole } from "./chart-tokens";
import { useElementWidth } from "./use-element-width";

export interface SparklineProps {
  values: readonly number[];
  role: ChartRole;
  height?: number;
  className?: string;
}

const PAD_X = 2;
const PAD_Y = 3;

export function Sparkline({
  values,
  role,
  height = 24,
  className,
}: SparklineProps) {
  const [measureRef, width] = useElementWidth(96);

  if (values.length < 2) {
    return null;
  }

  const minY = Math.min(...values);
  const maxY = Math.max(...values);
  const plotW = Math.max(16, width - PAD_X * 2);
  const plotH = Math.max(6, height - PAD_Y * 2);

  const xScale = linearScale([0, values.length - 1], [PAD_X, PAD_X + plotW]);
  const yScale =
    minY === maxY
      ? () => PAD_Y + plotH / 2
      : linearScale([minY, maxY], [PAD_Y + plotH, PAD_Y]);

  const d = values
    .map(
      (v, idx) =>
        `${idx === 0 ? "M" : "L"}${xScale(idx).toFixed(1)},${yScale(v).toFixed(1)}`,
    )
    .join(" ");

  return (
    <div ref={measureRef} aria-hidden="true" className={className ?? "w-24 shrink-0"}>
      <svg
        width={width}
        height={height}
        className="block overflow-visible"
      >
        <path
          d={d}
          fill="none"
          stroke={CHART_ROLE_COLOR[role]}
          strokeWidth={1.75}
          strokeDasharray={CHART_DASH_ARRAY}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
}
