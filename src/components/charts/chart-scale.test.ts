import { describe, expect, it } from "vitest";
import {
  formatAxisCentsDE,
  formatWholeEuroDE,
  linearScale,
  nearestIndex,
  niceCentTicks,
  pickDateTicks,
  pickYearTicks,
} from "./chart-scale";
import { isoDateToDayNumber } from "@/lib/domain/date";

describe("linearScale", () => {
  it("maps domain endpoints to range endpoints", () => {
    const scale = linearScale([0, 100], [10, 210]);
    expect(scale(0)).toBe(10);
    expect(scale(50)).toBe(110);
    expect(scale(100)).toBe(210);
  });

  it("handles zero-span domains by widening symmetrically", () => {
    const scale = linearScale([500, 500], [0, 100]);
    expect(scale(500)).toBe(50);
    expect(scale(499)).toBe(0);
    expect(scale(501)).toBe(100);
  });
});

describe("niceCentTicks", () => {
  it("produces ascending integer Euro-round ticks including 0", () => {
    const ticks = niceCentTicks(0, 1_234_567, 5);
    expect(ticks.length).toBeGreaterThanOrEqual(2);
    expect(ticks.length).toBeLessThanOrEqual(5);
    expect(ticks).toContain(0);
    expect(ticks[0]).toBeLessThanOrEqual(0);
    expect(ticks[ticks.length - 1]).toBeGreaterThanOrEqual(1_234_567);
    for (let i = 1; i < ticks.length; i++) {
      expect(ticks[i]!).toBeGreaterThan(ticks[i - 1]!);
      expect(Number.isInteger(ticks[i])).toBe(true);
    }
  });

  it("includes 0 for negative-to-positive ranges", () => {
    const ticks = niceCentTicks(-450_000, 920_000, 5);
    expect(ticks).toContain(0);
    expect(ticks[0]).toBeLessThanOrEqual(-450_000);
    expect(ticks[ticks.length - 1]).toBeGreaterThanOrEqual(920_000);
  });

  it("returns at least 2 ticks when min === max (including both 0)", () => {
    const zeroTicks = niceCentTicks(0, 0);
    expect(zeroTicks.length).toBeGreaterThanOrEqual(2);
    expect(zeroTicks).toContain(0);

    const sameTicks = niceCentTicks(50_000, 50_000);
    expect(sameTicks.length).toBeGreaterThanOrEqual(2);
    expect(sameTicks[0]).toBeLessThanOrEqual(50_000);
    expect(sameTicks[sameTicks.length - 1]).toBeGreaterThanOrEqual(50_000);
  });

  it("handles very large values (1 Mrd. €) without float artifacts", () => {
    const oneBillionEurCents = 100_000_000_000;
    const ticks = niceCentTicks(0, oneBillionEurCents, 5);
    expect(ticks.every((t) => Number.isSafeInteger(t))).toBe(true);
    expect(ticks[ticks.length - 1]).toBeGreaterThanOrEqual(oneBillionEurCents);
  });
});

describe("formatAxisCentsDE", () => {
  it("formats compact German axis labels", () => {
    expect(formatAxisCentsDE(0)).toBe("0 €");
    expect(formatAxisCentsDE(80_000)).toBe("800 €");
    expect(formatAxisCentsDE(5_000_000)).toBe("50 Tsd. €");
    expect(formatAxisCentsDE(125_000_000)).toBe("1,25 Mio. €");
    expect(formatAxisCentsDE(-2_000_000)).toBe("−20 Tsd. €");
  });
});

describe("formatWholeEuroDE", () => {
  it("rounds half-up on magnitude and formats with Unicode minus", () => {
    expect(formatWholeEuroDE(49)).toBe("0 €");
    expect(formatWholeEuroDE(50)).toBe("1 €");
    expect(formatWholeEuroDE(-150)).toBe("−2 €");
    expect(formatWholeEuroDE(-49)).toBe("0 €");
    expect(formatWholeEuroDE(1_234_549)).toBe("12.345 €");
  });

  it("supports showPlusSign without adding + to 0 €", () => {
    expect(formatWholeEuroDE(50, { showPlusSign: true })).toBe("+1 €");
    expect(formatWholeEuroDE(49, { showPlusSign: true })).toBe("0 €");
    expect(formatWholeEuroDE(-150, { showPlusSign: true })).toBe("−2 €");
  });
});

describe("nearestIndex", () => {
  it("returns -1 for empty arrays", () => {
    expect(nearestIndex([], 10)).toBe(-1);
  });

  it("finds exact match, clamps ends, and breaks ties to the left", () => {
    const xs = [0, 10, 20, 30];
    expect(nearestIndex(xs, -5)).toBe(0);
    expect(nearestIndex(xs, 0)).toBe(0);
    expect(nearestIndex(xs, 10)).toBe(1);
    expect(nearestIndex(xs, 15)).toBe(1); // tie -> left
    expect(nearestIndex(xs, 16)).toBe(2);
    expect(nearestIndex(xs, 99)).toBe(3);
  });
});

describe("pickYearTicks", () => {
  it("handles mid-year start, short horizons, and maxTicks thinning", () => {
    const short = pickYearTicks("2026-07", 5, 6);
    expect(short[0]).toEqual({ x: 0, label: "heute" });
    expect(short[short.length - 1]?.x).toBe(5);

    const long = pickYearTicks("2026-07", 360, 6);
    expect(long[0]).toEqual({ x: 0, label: "heute" });
    expect(long.length).toBeLessThanOrEqual(6);
    expect(long[long.length - 1]?.x).toBe(360);
  });

  it("aligns prepayment axis when passed startMonth + 1 so last tick matches xTooltipLabel(horizonMonths)", () => {
    // Prepayment timeline: x=0 is startYm (2026-11), x=2 is 01/2027, x=12 is 11/2027.
    const ticks = pickYearTicks("2026-12", 12, 7);
    expect(ticks[0]).toEqual({ x: 0, label: "heute" });
    expect(ticks.find((t) => t.label === "2027")?.x).toBe(2);
    expect(ticks[ticks.length - 1]).toEqual({ x: 12, label: "11/2027" });
  });
});

describe("pickDateTicks", () => {
  it("picks month ticks for ~3M span, year ticks for 3Y span, and single 'heute' for zero span", () => {
    const from3m = isoDateToDayNumber("2026-08-19");
    const to3m = isoDateToDayNumber("2026-11-19");
    const ticks3m = pickDateTicks(from3m, to3m);
    expect(ticks3m[0]).toEqual({ x: from3m, label: "19.08." });
    expect(ticks3m[ticks3m.length - 1]).toEqual({ x: to3m, label: "heute" });
    expect(ticks3m.some((t) => t.label === "09/2026")).toBe(true);
    expect(ticks3m.some((t) => t.label === "10/2026")).toBe(true);

    const from3y = isoDateToDayNumber("2024-05-01");
    const to3y = isoDateToDayNumber("2027-08-01");
    const ticks3y = pickDateTicks(from3y, to3y);
    expect(ticks3y[0]).toEqual({ x: from3y, label: "01.05." });
    expect(ticks3y[ticks3y.length - 1]).toEqual({ x: to3y, label: "heute" });
    expect(ticks3y.some((t) => t.label === "2025")).toBe(true);
    expect(ticks3y.some((t) => t.label === "2026")).toBe(true);
    expect(ticks3y.some((t) => t.label === "2027")).toBe(true);

    // Strictly ascending and no duplicates
    for (let i = 1; i < ticks3y.length; i++) {
      expect(ticks3y[i]!.x).toBeGreaterThan(ticks3y[i - 1]!.x);
    }

    // Zero span
    expect(pickDateTicks(to3m, to3m)).toEqual([{ x: to3m, label: "heute" }]);
  });

  it("supports projection variant with MM/JJJJ start and end, no 'heute'", () => {
    const fromMulti = isoDateToDayNumber("2026-01-01");
    const toMulti = isoDateToDayNumber("2036-06-01");
    const ticksMulti = pickDateTicks(fromMulti, toMulti, 6, {
      variant: "projection",
    });
    expect(ticksMulti[0]).toEqual({ x: fromMulti, label: "01/2026" });
    expect(ticksMulti[ticksMulti.length - 1]).toEqual({
      x: toMulti,
      label: "06/2036",
    });
    expect(ticksMulti.some((t) => t.label === "heute")).toBe(false);
    expect(ticksMulti.length).toBeLessThanOrEqual(6);

    // < 13 months uses month ticks and skips duplicate start/end month labels
    const fromShort = isoDateToDayNumber("2026-03-15");
    const toShort = isoDateToDayNumber("2026-10-20");
    const ticksShort = pickDateTicks(fromShort, toShort, 6, {
      variant: "projection",
    });
    expect(ticksShort[0]).toEqual({ x: fromShort, label: "03/2026" });
    expect(ticksShort[ticksShort.length - 1]).toEqual({
      x: toShort,
      label: "10/2026",
    });
    expect(ticksShort.filter((t) => t.label === "10/2026")).toHaveLength(1);
    expect(ticksShort.some((t) => t.label === "heute")).toBe(false);

    // Same month at start and end yields single tick
    const sameFrom = isoDateToDayNumber("2026-05-01");
    const sameTo = isoDateToDayNumber("2026-05-28");
    expect(
      pickDateTicks(sameFrom, sameTo, 6, { variant: "projection" }),
    ).toEqual([{ x: sameFrom, label: "05/2026" }]);

    // to <= from yields single date tick, not 'heute'
    expect(
      pickDateTicks(toShort, fromShort, 6, { variant: "projection" }),
    ).toEqual([{ x: fromShort, label: "03/2026" }]);
    expect(
      pickDateTicks(toShort, toShort, 6, { variant: "projection" }),
    ).toEqual([{ x: toShort, label: "10/2026" }]);

    // maxTicks = 2 returns only start and end
    const twoTicks = pickDateTicks(fromMulti, toMulti, 2, {
      variant: "projection",
    });
    expect(twoTicks).toEqual([
      { x: fromMulti, label: "01/2026" },
      { x: toMulti, label: "06/2036" },
    ]);

    // Inner ticks maintain minGap to both neighbors and end
    const span = toMulti - fromMulti;
    const minGap = Math.max(1, Math.round(span / Math.max(4, 6 * 2)));
    for (let i = 1; i < ticksMulti.length - 1; i++) {
      expect(ticksMulti[i]!.x - ticksMulti[i - 1]!.x).toBeGreaterThanOrEqual(
        minGap,
      );
      expect(toMulti - ticksMulti[i]!.x).toBeGreaterThanOrEqual(minGap);
    }
  });
});
