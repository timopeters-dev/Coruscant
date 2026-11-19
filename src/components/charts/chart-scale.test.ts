import { describe, expect, it } from "vitest";
import {
  formatAxisCentsDE,
  formatWholeEuroDE,
  linearScale,
  nearestIndex,
  niceCentTicks,
  pickYearTicks,
} from "./chart-scale";

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
