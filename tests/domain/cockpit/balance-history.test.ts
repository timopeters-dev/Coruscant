import { describe, expect, it } from "vitest";
import type { BalanceSummary } from "@/domain/cockpit/balance";
import {
  buildBalanceSnapshotRecord,
  computeComponentDeltas,
  filterHistoryByRange,
  markHistoryGaps,
  selectMonthEndValues,
  summarizeHistoryRange,
  thinHistory,
  type BalanceHistoryPoint,
} from "@/domain/cockpit/balance-history";
import { addDaysToIsoDate } from "@/domain/core/date";

function makeSummary(overrides: Partial<BalanceSummary> = {}): BalanceSummary {
  const freeAssetsCents = overrides.freeAssetsCents ?? 1_500_000;
  const propertiesValueCents = overrides.propertiesValueCents ?? 25_000_000;
  const savingsContractsValueCents =
    overrides.savingsContractsValueCents ?? 500_000;
  const boundAssetsCents =
    overrides.boundAssetsCents ??
    propertiesValueCents + savingsContractsValueCents;
  const totalAssetsCents =
    overrides.totalAssetsCents ?? freeAssetsCents + boundAssetsCents;
  const liabilitiesCents = overrides.liabilitiesCents ?? 12_000_000;
  const netWorthCents =
    overrides.netWorthCents ?? totalAssetsCents - liabilitiesCents;

  return {
    asOfDate: "2026-11-19",
    freeAssetsCents,
    conflictingLinkedPotsCents: 0,
    outOfScopeLinkedPotsCents: 0,
    propertiesValueCents,
    savingsContractsValueCents,
    boundAssetsCents,
    totalAssetsCents,
    liabilitiesCents,
    netWorthCents,
    ...overrides,
  };
}

function makePoint(
  date: string,
  overrides: Partial<BalanceHistoryPoint> = {},
): BalanceHistoryPoint {
  const freeAssetsCents = overrides.freeAssetsCents ?? 1_000_000;
  const propertiesValueCents = overrides.propertiesValueCents ?? 0;
  const savingsContractsValueCents =
    overrides.savingsContractsValueCents ?? 0;
  const boundAssetsCents =
    overrides.boundAssetsCents ??
    propertiesValueCents + savingsContractsValueCents;
  const totalAssetsCents =
    overrides.totalAssetsCents ?? freeAssetsCents + boundAssetsCents;
  const liabilitiesCents = overrides.liabilitiesCents ?? 200_000;
  const netWorthCents =
    overrides.netWorthCents ?? totalAssetsCents - liabilitiesCents;

  return {
    date,
    totalAssetsCents,
    liabilitiesCents,
    netWorthCents,
    freeAssetsCents,
    boundAssetsCents,
    propertiesValueCents,
    savingsContractsValueCents,
    hasModeledValues: overrides.hasModeledValues ?? propertiesValueCents > 0,
  };
}

describe("buildBalanceSnapshotRecord", () => {
  it("builds a valid record on the happy path", () => {
    const record = buildBalanceSnapshotRecord(makeSummary(), {
      projectedContractsCount: 0,
    });
    expect(record).toEqual({
      date: "2026-11-19",
      totalAssetsCents: 27_000_000,
      liabilitiesCents: 12_000_000,
      netWorthCents: 15_000_000,
      freeAssetsCents: 1_500_000,
      boundAssetsCents: 25_500_000,
      propertiesValueCents: 25_000_000,
      savingsContractsValueCents: 500_000,
      hasModeledValues: true,
    });
  });

  it("returns null for an empty balance sheet (0 assets and 0 liabilities)", () => {
    const empty = makeSummary({
      freeAssetsCents: 0,
      propertiesValueCents: 0,
      savingsContractsValueCents: 0,
      boundAssetsCents: 0,
      totalAssetsCents: 0,
      liabilitiesCents: 0,
      netWorthCents: 0,
    });
    expect(
      buildBalanceSnapshotRecord(empty, { projectedContractsCount: 0 }),
    ).toBeNull();
  });

  it("allows liabilities-only snapshots with negative netWorthCents and 0-cent components", () => {
    const debtOnly = makeSummary({
      freeAssetsCents: 0,
      propertiesValueCents: 0,
      savingsContractsValueCents: 0,
      boundAssetsCents: 0,
      totalAssetsCents: 0,
      liabilitiesCents: 500_000,
      netWorthCents: -500_000,
    });
    const record = buildBalanceSnapshotRecord(debtOnly, {
      projectedContractsCount: 1,
    });
    expect(record?.netWorthCents).toBe(-500_000);
    expect(record?.hasModeledValues).toBe(true);
  });

  it("sets hasModeledValues correctly from properties or projected contracts", () => {
    const pureCash = makeSummary({
      freeAssetsCents: 100_000,
      propertiesValueCents: 0,
      savingsContractsValueCents: 0,
      boundAssetsCents: 0,
      totalAssetsCents: 100_000,
      liabilitiesCents: 0,
      netWorthCents: 100_000,
    });
    expect(
      buildBalanceSnapshotRecord(pureCash, { projectedContractsCount: 0 })
        ?.hasModeledValues,
    ).toBe(false);
    expect(
      buildBalanceSnapshotRecord(pureCash, { projectedContractsCount: 1 })
        ?.hasModeledValues,
    ).toBe(true);
  });

  it("throws RangeError on violated invariants or invalid numbers", () => {
    expect(() =>
      buildBalanceSnapshotRecord(
        makeSummary({ totalAssetsCents: 999 }),
        { projectedContractsCount: 0 },
      ),
    ).toThrow(RangeError);
    expect(() =>
      buildBalanceSnapshotRecord(
        makeSummary({ netWorthCents: 123 }),
        { projectedContractsCount: 0 },
      ),
    ).toThrow(RangeError);
    expect(() =>
      buildBalanceSnapshotRecord(
        makeSummary({ freeAssetsCents: -1 }),
        { projectedContractsCount: 0 },
      ),
    ).toThrow(RangeError);
    expect(() =>
      buildBalanceSnapshotRecord(
        makeSummary({ freeAssetsCents: 10.5 }),
        { projectedContractsCount: 0 },
      ),
    ).toThrow(RangeError);
  });
});

describe("filterHistoryByRange", () => {
  it("handles empty lists and single-point lists", () => {
    expect(filterHistoryByRange([], "12m", "2026-11-19")).toEqual({
      from: "2025-11-19",
      points: [],
    });
    const single = [makePoint("2026-11-10")];
    expect(filterHistoryByRange(single, "3m", "2026-11-19").points).toEqual(
      single,
    );
  });

  it("includes boundary dates, discards future dates, and clamps month-ends", () => {
    // 2027-05-31 - 3M = 2027-02-28
    const res2027 = filterHistoryByRange(
      [
        makePoint("2027-02-27"),
        makePoint("2027-02-28"),
        makePoint("2027-05-31"),
        makePoint("2027-06-01"),
      ],
      "3m",
      "2027-05-31",
    );
    expect(res2027.from).toBe("2027-02-28");
    expect(res2027.points.map((p) => p.date)).toEqual([
      "2027-02-28",
      "2027-05-31",
    ]);

    // 2028-05-31 - 3M = 2028-02-29 (leap year)
    const res2028 = filterHistoryByRange([], "3m", "2028-05-31");
    expect(res2028.from).toBe("2028-02-29");
  });

  it("supports 'all' without lower bound, sorts without mutating, and deduplicates (last wins)", () => {
    const input = [
      makePoint("2026-03-01", { freeAssetsCents: 100 }),
      makePoint("2025-01-01", { freeAssetsCents: 200 }),
      makePoint("2026-03-01", { freeAssetsCents: 999 }),
    ];
    const snapshot = [...input];
    const res = filterHistoryByRange(input, "all", "2026-11-19");
    expect(input).toEqual(snapshot);
    expect(res.from).toBeNull();
    expect(res.points.map((p) => [p.date, p.freeAssetsCents])).toEqual([
      ["2025-01-01", 200],
      ["2026-03-01", 999],
    ]);
  });
});

describe("markHistoryGaps", () => {
  it("marks gaps strictly > 7 days and counts multiple gaps", () => {
    const marked = markHistoryGaps([
      makePoint("2026-10-01"),
      makePoint("2026-10-08"), // 7 days -> no gap
      makePoint("2026-10-16"), // 8 days -> gap
      makePoint("2026-10-20"), // 4 days -> no gap
      makePoint("2026-11-01"), // 12 days -> gap
    ]);
    expect(marked.map((p) => [p.date, p.gapBefore, p.gapDays])).toEqual([
      ["2026-10-01", false, null],
      ["2026-10-08", false, null],
      ["2026-10-16", true, 8],
      ["2026-10-20", false, null],
      ["2026-11-01", true, 12],
    ]);
  });
});

describe("thinHistory", () => {
  it("keeps arrays <= maxPoints unchanged", () => {
    const marked = markHistoryGaps([
      makePoint("2026-10-01"),
      makePoint("2026-10-15"),
    ]);
    expect(thinHistory(marked, 400)).toEqual(marked);
  });

  it("thins > 400 points to 1 per ISO week, preserves gapBefore, last point, and year-boundary ISO weeks", () => {
    const raw: BalanceHistoryPoint[] = [];
    // 410 consecutive days starting 2025-12-29 (Mon, 2026-W01) with a gap skipped in Jan 2026
    for (let i = 0; i < 420; i++) {
      const date = addDaysToIsoDate("2025-12-29", i);
      // Skip 2026-01-10 .. 2026-01-20 to create a 12-day gap
      if (date >= "2026-01-10" && date <= "2026-01-20") {
        continue;
      }
      raw.push(makePoint(date, { freeAssetsCents: i * 100 }));
    }
    expect(raw.length).toBeGreaterThan(400);

    const marked = markHistoryGaps(raw);
    const thinned = thinHistory(marked, 400);

    expect(thinned.length).toBeLessThan(100);
    // 2025-12-29 .. 2026-01-04 are all ISO week 2026-W01 -> collapsed to 2026-01-04
    expect(thinned[0]?.date).toBe("2026-01-04");
    // Last point is always preserved
    expect(thinned[thinned.length - 1]?.date).toBe(raw[raw.length - 1]?.date);
    // Gap after 2026-01-09 -> 2026-01-21 (in 2026-W04) is preserved
    const gapPoint = thinned.find((p) => p.gapBefore);
    expect(gapPoint?.date).toBe("2026-01-25");
  });
});

describe("summarizeHistoryRange & computeComponentDeltas", () => {
  it("handles 0/1 points and negative net worth transitions", () => {
    expect(summarizeHistoryRange([])).toEqual({
      count: 0,
      first: null,
      last: null,
      netWorthDeltaCents: null,
      gapCount: 0,
      anyModeled: false,
    });

    const one = markHistoryGaps([makePoint("2026-11-18")]);
    expect(summarizeHistoryRange(one).netWorthDeltaCents).toBeNull();

    const two = markHistoryGaps([
      makePoint("2026-11-01", {
        freeAssetsCents: 300_000,
        liabilitiesCents: 200_000, // net +100_000
      }),
      makePoint("2026-11-18", {
        freeAssetsCents: 100_000,
        liabilitiesCents: 250_000, // net -150_000
      }),
    ]);
    const summary = summarizeHistoryRange(two);
    expect(summary.netWorthDeltaCents).toBe(-250_000);
    expect(summary.count).toBe(2);
  });

  it("computes component deltas only when firstInRange is before today", () => {
    const live = {
      freeAssetsCents: 1_200_000,
      boundAssetsCents: 2_000_000,
      liabilitiesCents: 900_000,
    };
    expect(computeComponentDeltas(live, null, "2026-11-19")).toBeNull();
    expect(
      computeComponentDeltas(
        live,
        makePoint("2026-11-19"),
        "2026-11-19",
      ),
    ).toBeNull();

    expect(
      computeComponentDeltas(
        live,
        makePoint("2026-10-01", {
          freeAssetsCents: 1_000_000,
          propertiesValueCents: 1_800_000,
          liabilitiesCents: 1_000_000,
        }),
        "2026-11-19",
      ),
    ).toEqual({
      sinceDate: "2026-10-01",
      freeAssetsDeltaCents: 200_000,
      boundAssetsDeltaCents: 200_000,
      liabilitiesDeltaCents: -100_000,
    });
  });
});

describe("selectMonthEndValues", () => {
  it("picks the last point per calendar month descending, capped at 12, skipping gap months", () => {
    const points: BalanceHistoryPoint[] = [];
    for (let m = 1; m <= 12; m++) {
      if (m === 5) continue; // gap month
      const mm = String(m).padStart(2, "0");
      points.push(makePoint(`2026-${mm}-01`, { freeAssetsCents: m * 100 }));
      points.push(makePoint(`2026-${mm}-15`, { freeAssetsCents: m * 1000 }));
    }
    points.push(makePoint("2027-01-10", { freeAssetsCents: 13_000 }));
    points.push(makePoint("2027-02-10", { freeAssetsCents: 14_000 }));

    const rows = selectMonthEndValues(points, 12);
    expect(rows).toHaveLength(12);
    expect(rows[0]?.month).toBe("2027-02");
    expect(rows[0]?.point.date).toBe("2027-02-10");
    expect(rows.some((r) => r.month === "2026-05")).toBe(false);
    expect(rows[11]?.month).toBe("2026-02");
    expect(rows[11]?.point.date).toBe("2026-02-15");
  });
});
