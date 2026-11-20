import type { LineSeries } from "@/frontend/charts/line-chart";
import type { MarkedBalanceHistoryPoint } from "@/domain/cockpit/balance-history";
import { dayNumberToIsoDate, isoDateToDayNumber } from "@/domain/core/date";

/**
 * Formats a UTC day number into German DD.MM.YYYY.
 */
export function formatHistoryDateLabel(dayNumber: number): string {
  const iso = dayNumberToIsoDate(dayNumber);
  const [y, m, d] = iso.split("-");
  return `${d}.${m}.${y}`;
}

/**
 * Builds the 2-series configuration for the main Cockpit history chart:
 * Net Worth (dashed if any point contains modeled values) and Free Assets (solid, Ist).
 */
export function buildNetWorthSeries(
  marked: readonly MarkedBalanceHistoryPoint[],
  opts: { anyModeled: boolean },
): LineSeries[] {
  return [
    {
      id: "net",
      label: "Nettovermögen",
      role: "netWorth",
      dashed: opts.anyModeled,
      points: marked.map((p) => ({
        x: isoDateToDayNumber(p.date),
        y: p.netWorthCents,
        gapBefore: p.gapBefore,
      })),
    },
    {
      id: "free",
      label: "Frei (Ist)",
      role: "free",
      dashed: false,
      points: marked.map((p) => ({
        x: isoDateToDayNumber(p.date),
        y: p.freeAssetsCents,
        gapBefore: p.gapBefore,
      })),
    },
  ];
}

/**
 * Builds the 3-series configuration for the Balance History Drawer:
 * Free (solid), Bound (dashed if modeled), Liabilities (dashed if modeled, positive).
 */
export function buildComponentSeries(
  marked: readonly MarkedBalanceHistoryPoint[],
  anyModeled: boolean,
): LineSeries[] {
  return [
    {
      id: "free",
      label: "Frei (Ist)",
      role: "free",
      dashed: false,
      points: marked.map((p) => ({
        x: isoDateToDayNumber(p.date),
        y: p.freeAssetsCents,
        gapBefore: p.gapBefore,
      })),
    },
    {
      id: "bound",
      label: "Gebunden",
      role: "bound",
      dashed: anyModeled,
      points: marked.map((p) => ({
        x: isoDateToDayNumber(p.date),
        y: p.boundAssetsCents,
        gapBefore: p.gapBefore,
      })),
    },
    {
      id: "liabilities",
      label: "Schulden",
      role: "liabilities",
      dashed: anyModeled,
      points: marked.map((p) => ({
        x: isoDateToDayNumber(p.date),
        y: p.liabilitiesCents,
        gapBefore: p.gapBefore,
      })),
    },
  ];
}
