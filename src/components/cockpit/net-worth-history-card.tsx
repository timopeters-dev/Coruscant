"use client";

import { formatDateDE } from "@/lib/domain/date-format";
import { CalendarClock } from "lucide-react";
import * as React from "react";
import { ChartLegend } from "@/components/charts/chart-legend";
import { pickDateTicks } from "@/components/charts/chart-scale";
import { LineChart } from "@/components/charts/line-chart";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type {
  BalanceHistoryPoint,
  HistoryRangeId,
  HistoryRangeSummary,
  MarkedBalanceHistoryPoint,
} from "@/lib/domain/balance-history";
import { isoDateToDayNumber } from "@/lib/domain/date";
import { formatWholeEuroDE } from "@/lib/domain/money";
import {
  buildNetWorthSeries,
  formatHistoryDateLabel,
} from "./history-chart-data";
import {
  HISTORY_RANGE_OPTIONS,
  HistoryRangeSwitch,
} from "./history-range-switch";

interface NetWorthHistoryCardProps {
  totalCount: number;
  singlePoint: BalanceHistoryPoint | null;
  points: readonly MarkedBalanceHistoryPoint[];
  summary: HistoryRangeSummary;
  range: HistoryRangeId;
  fromIso: string | null;
  todayIso: string;
  onRangeChange: (next: HistoryRangeId) => void;
}

export function NetWorthHistoryCard({
  totalCount,
  singlePoint,
  points,
  summary,
  range,
  fromIso,
  todayIso,
  onRangeChange,
}: NetWorthHistoryCardProps) {
  const pointByDay = React.useMemo(() => {
    const map = new Map<number, MarkedBalanceHistoryPoint>();
    for (const pt of points) {
      map.set(isoDateToDayNumber(pt.date), pt);
    }
    return map;
  }, [points]);

  const series = React.useMemo(
    () => buildNetWorthSeries(points, { anyModeled: summary.anyModeled }),
    [points, summary.anyModeled],
  );

  const rangeLabel =
    HISTORY_RANGE_OPTIONS.find((opt) => opt.id === range)?.label ?? range;

  const toDay = isoDateToDayNumber(todayIso);
  const fromDay =
    fromIso !== null
      ? isoDateToDayNumber(fromIso)
      : summary.first
        ? isoDateToDayNumber(summary.first.date)
        : toDay;
  const xTicks = React.useMemo(
    () => pickDateTicks(fromDay, toDay, 6),
    [fromDay, toDay],
  );

  return (
    <Card
      className={
        summary.anyModeled
          ? "border-dashed border-[var(--border-sub)]"
          : undefined
      }
    >
      <CardHeader className="flex flex-col gap-3 pb-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle className="text-base">Nettovermögen-Verlauf</CardTitle>
          {summary.anyModeled ? <StatusBadge variant="modeled" /> : null}
        </div>
        <HistoryRangeSwitch value={range} onChange={onRangeChange} />
      </CardHeader>

      <CardContent className="space-y-3">
        {totalCount === 0 ? (
          <div className="flex items-center gap-2.5 rounded-lg border border-dashed border-[var(--border-sub)] bg-[var(--surface-elevated)]/40 px-4 py-6 text-xs text-[var(--text-secondary)]">
            <CalendarClock className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span>
              Der Verlauf entsteht mit der Zeit. Coruscant hält ab jetzt einmal
              täglich den Stand fest.
            </span>
          </div>
        ) : totalCount === 1 && singlePoint ? (
          <div className="flex items-center gap-2.5 rounded-lg border border-dashed border-[var(--border-sub)] bg-[var(--surface-elevated)]/40 px-4 py-6 text-xs text-[var(--text-secondary)]">
            <CalendarClock className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span className="tabular-nums">
              Erster Stand am {formatDateDE(singlePoint.date)}: Netto{" "}
              {formatWholeEuroDE(singlePoint.netWorthCents)}. Ab dem nächsten
              Tag entsteht der Verlauf.
            </span>
          </div>
        ) : summary.count < 2 ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-dashed border-[var(--border-sub)] bg-[var(--surface-elevated)]/40 px-4 py-6 text-xs text-[var(--text-secondary)]">
            <div className="flex items-center gap-2.5">
              <CalendarClock className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span>
                {summary.count === 0
                  ? "Im gewählten Zeitraum liegt keine Momentaufnahme vor."
                  : `Im gewählten Zeitraum liegt nur ${summary.count} Momentaufnahme vor.`}
              </span>
            </div>
            {range !== "all" ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => onRangeChange("all")}
              >
                Alles anzeigen
              </Button>
            ) : null}
          </div>
        ) : (
          <>
            {summary.netWorthDeltaCents !== null && summary.first ? (
              <p className="tabular-nums text-sm text-[var(--text-secondary)]">
                Nettovermögen{" "}
                <span className="font-semibold text-[var(--text-primary)]">
                  {formatWholeEuroDE(summary.netWorthDeltaCents, {
                    showPlusSign: true,
                  })}
                </span>{" "}
                seit {formatDateDE(summary.first.date)}
              </p>
            ) : null}

            <LineChart
              series={series}
              xDomain={[fromDay, toDay]}
              xTicks={xTicks}
              xTooltipLabel={formatHistoryDateLabel}
              height={240}
              ariaLabel={`Verlauf Nettovermögen und freies Vermögen, Zeitraum ${rangeLabel}`}
              tooltipExtra={(_, x) => {
                if (x === undefined) return null;
                const pt = pointByDay.get(x);
                if (!pt) return null;
                return {
                  label: "Gebunden / Schulden",
                  value: `${formatWholeEuroDE(pt.boundAssetsCents)} / ${formatWholeEuroDE(pt.liabilitiesCents)}`,
                };
              }}
            />

            <div className="flex flex-wrap items-center justify-between gap-2 pt-1 text-xs text-[var(--text-secondary)]">
              <ChartLegend
                items={[
                  {
                    label: summary.anyModeled
                      ? "Nettovermögen (Modelliert)"
                      : "Nettovermögen",
                    role: "netWorth",
                    dashed: summary.anyModeled,
                  },
                  {
                    label: "Frei (Ist)",
                    role: "free",
                    dashed: false,
                  },
                ]}
              />
              <div className="flex flex-wrap items-center gap-3 tabular-nums">
                {summary.gapCount > 0 ? (
                  <span>
                    {summary.gapCount}{" "}
                    {summary.gapCount === 1 ? "Lücke" : "Lücken"} &gt; 7 Tage –
                    nicht überbrückt
                  </span>
                ) : null}
                <span>
                  {summary.count} Momentaufnahmen · tägliche Erfassung
                </span>
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
