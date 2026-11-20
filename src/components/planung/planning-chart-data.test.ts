import { describe, expect, it } from "vitest";
import type { CashflowChangeSeries } from "@/lib/domain/cashflow-change-series";
import type {
  CashflowChangeResult,
  PrepaymentTimelinePoint,
} from "@/lib/domain/scenarios";
import {
  pickTimelineHorizonMonths,
  toFillTimelineRows,
  toPrepaymentSeries,
  toSavingsSeries,
  xLabelForMonthIndex,
} from "./planning-chart-data";

function makePoint(monthIndex: number, a: number, b: number): PrepaymentTimelinePoint {
  return {
    monthIndex,
    date: "2026-11-19",
    debtA: 0,
    debtB: 0,
    etfGrossA: 0,
    etfGrossB: 0,
    netWorthA: a,
    netWorthB: b,
  };
}

describe("toPrepaymentSeries", () => {
  it("samples yearly points plus last point without duplicating year-end", () => {
    const timeline = Array.from({ length: 31 }, (_, i) =>
      makePoint(i, i * 1000, i * 1200),
    );
    const series = toPrepaymentSeries(timeline);
    expect(series).toHaveLength(2);
    const s0 = series[0]!;
    const s1 = series[1]!;
    expect(s0.dashed).toBe(true);
    expect(s1.dashed).toBe(true);
    expect(s0.points.map((p) => p.x)).toEqual([0, 12, 24, 30]);
    expect(s0.points[2]?.y).toBe(24_000);
    expect(s1.points[3]?.y).toBe(36_000);

    const exactYear = Array.from({ length: 25 }, (_, i) =>
      makePoint(i, i * 100, i * 200),
    );
    expect(toPrepaymentSeries(exactYear)[0]?.points.map((p) => p.x)).toEqual([
      0, 12, 24,
    ]);
  });

  it("returns empty array for fewer than 2 points", () => {
    expect(toPrepaymentSeries([])).toEqual([]);
    expect(toPrepaymentSeries([makePoint(0, 0, 0)])).toEqual([]);
  });
});

describe("pickTimelineHorizonMonths & toFillTimelineRows", () => {
  const baseResult: CashflowChangeResult = {
    horizonMonths: 360,
    scenarioSurplusAfterChangeCents: 100_000,
    baselineDeficitMonths: 0,
    scenarioDeficitMonths: 0,
    pots: [
      {
        potId: "p1",
        potName: "Notgroschen",
        priority: 1,
        targetCents: 100_000,
        hasTarget: true,
        alreadyFilled: true,
        baselineMonthsToFill: 0,
        baselineFillMonth: "2027-01",
        scenarioMonthsToFill: 0,
        scenarioFillMonth: "2027-01",
        monthsGained: 0,
      },
      {
        potId: "p2",
        potName: "Urlaub",
        priority: 2,
        targetCents: 200_000,
        hasTarget: true,
        alreadyFilled: false,
        baselineMonthsToFill: null,
        baselineFillMonth: null,
        scenarioMonthsToFill: 5,
        scenarioFillMonth: "2027-05",
        monthsGained: null,
      },
      {
        potId: "p3",
        potName: "Reserve",
        priority: 3,
        targetCents: null,
        hasTarget: false,
        alreadyFilled: false,
        baselineMonthsToFill: null,
        baselineFillMonth: null,
        scenarioMonthsToFill: null,
        scenarioFillMonth: null,
        monthsGained: null,
      },
      {
        potId: "p4",
        potName: "Auto",
        priority: 4,
        targetCents: 500_000,
        hasTarget: true,
        alreadyFilled: false,
        baselineMonthsToFill: 10,
        baselineFillMonth: "2027-10",
        scenarioMonthsToFill: 14,
        scenarioFillMonth: "2028-02",
        monthsGained: -4,
      },
      {
        potId: "p5",
        potName: "Haus",
        priority: 5,
        targetCents: 900_000,
        hasTarget: true,
        alreadyFilled: false,
        baselineMonthsToFill: null,
        baselineFillMonth: null,
        scenarioMonthsToFill: null,
        scenarioFillMonth: null,
        monthsGained: null,
      },
    ],
  };

  it("picks horizon clamped between 24 and horizonMonths, or 60 when no fill month", () => {
    expect(pickTimelineHorizonMonths(baseResult, 360)).toBe(26);
    expect(
      pickTimelineHorizonMonths(
        {
          ...baseResult,
          pots: [
            {
              ...baseResult.pots[1]!,
              baselineMonthsToFill: 5,
              scenarioMonthsToFill: 3,
            },
          ],
        },
        360,
      ),
    ).toBe(24);
    expect(
      pickTimelineHorizonMonths(
        {
          ...baseResult,
          pots: [
            {
              ...baseResult.pots[1]!,
              baselineMonthsToFill: 100,
              scenarioMonthsToFill: 80,
            },
          ],
        },
        360,
      ),
    ).toBe(112);
    expect(
      pickTimelineHorizonMonths(
        {
          ...baseResult,
          pots: [baseResult.pots[4]!],
        },
        360,
      ),
    ).toBe(60);
    expect(
      pickTimelineHorizonMonths(
        {
          ...baseResult,
          pots: [baseResult.pots[4]!],
        },
        36,
      ),
    ).toBe(36);
  });

  it("maps target pots in priority order with expected statuses", () => {
    const rows = toFillTimelineRows(baseResult);
    expect(rows.map((r) => r.id)).toEqual(["p1", "p2", "p4", "p5"]);
    expect(rows[0]?.status).toBe("filled");
    expect(rows[1]?.status).toBe("scenario_only");
    expect(rows[2]).toEqual({
      id: "p4",
      label: "Auto",
      status: "both",
      from: 10,
      to: 14,
    });
    expect(rows[3]?.status).toBe("none");
  });
});

describe("toSavingsSeries & xLabelForMonthIndex", () => {
  it("uses quarterly sampling above 120 months and formats month labels", () => {
    const len = 151;
    const series: CashflowChangeSeries = {
      horizonMonths: 150,
      months: Array.from({ length: len }, () => "2027-01"),
      baseline: {
        totalCents: Array.from({ length: len }, (_, i) => i * 100),
        byPotId: {},
        deficitMonths: 0,
      },
      scenario: {
        totalCents: Array.from({ length: len }, (_, i) => i * 200),
        byPotId: {},
        deficitMonths: 0,
      },
    };

    const result = toSavingsSeries(series, 130);
    expect(result).toHaveLength(2);
    const r0 = result[0]!;
    expect(r0.points[0]).toEqual({ x: 0, y: 0 });
    expect(r0.points[1]).toEqual({ x: 3, y: 300 });
    expect(r0.points[r0.points.length - 1]).toEqual({
      x: 130,
      y: 13000,
    });

    expect(xLabelForMonthIndex("2026-12", 0)).toBe("heute");
    expect(xLabelForMonthIndex("2026-12", 1)).toBe("12.2026");
    expect(xLabelForMonthIndex("2026-12", 2)).toBe("01.2027");
  });
});
