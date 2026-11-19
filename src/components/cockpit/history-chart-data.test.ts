import { describe, expect, it } from "vitest";
import { markHistoryGaps } from "@/lib/domain/balance-history";
import { isoDateToDayNumber } from "@/lib/domain/date";
import {
  buildComponentSeries,
  buildNetWorthSeries,
  formatHistoryDateLabel,
} from "./history-chart-data";

const sample = markHistoryGaps([
  {
    date: "2026-10-01",
    totalAssetsCents: 2_000_000,
    liabilitiesCents: 800_000,
    netWorthCents: 1_200_000,
    freeAssetsCents: 500_000,
    boundAssetsCents: 1_500_000,
    propertiesValueCents: 1_500_000,
    savingsContractsValueCents: 0,
    hasModeledValues: true,
  },
  {
    date: "2026-10-15",
    totalAssetsCents: 2_100_000,
    liabilitiesCents: 750_000,
    netWorthCents: 1_350_000,
    freeAssetsCents: 600_000,
    boundAssetsCents: 1_500_000,
    propertiesValueCents: 1_500_000,
    savingsContractsValueCents: 0,
    hasModeledValues: true,
  },
]);

describe("history-chart-data", () => {
  it("formats UTC day numbers as DD.MM.YYYY", () => {
    expect(formatHistoryDateLabel(isoDateToDayNumber("2026-11-19"))).toBe(
      "19.11.2026",
    );
  });

  it("sets netWorth dashed iff anyModeled, keeps free solid, and forwards gapBefore", () => {
    const modeled = buildNetWorthSeries(sample, { anyModeled: true });
    expect(modeled[0]?.dashed).toBe(true);
    expect(modeled[1]?.dashed).toBe(false);
    expect(modeled[0]?.points[1]?.gapBefore).toBe(true);

    const pure = buildNetWorthSeries(sample, { anyModeled: false });
    expect(pure[0]?.dashed).toBe(false);
    expect(pure[1]?.dashed).toBe(false);
  });

  it("builds component series with positive liabilities and gapBefore", () => {
    const comp = buildComponentSeries(sample, true);
    expect(comp.map((s) => [s.id, s.dashed])).toEqual([
      ["free", false],
      ["bound", true],
      ["liabilities", true],
    ]);
    expect(comp[2]?.points[0]?.y).toBe(800_000);
    expect(comp[2]?.points[1]?.gapBefore).toBe(true);
  });
});
