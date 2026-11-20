import { describe, expect, it } from "vitest";
import { simulateCashflowChangeSeries } from "@/domain/allocation/cashflow-change-series";
import { simulateCashflowChange } from "@/domain/planning/cashflow-change";
import type { DomainPot } from "@/domain/allocation/waterfall";

const samplePots: DomainPot[] = [
  {
    id: "pot-1",
    name: "Notgroschen",
    priority: 1,
    currentCents: 100_000,
    targetCents: 300_000,
    ruleType: "fill_to_target",
    fixedMonthlyCents: null,
    remainderPercentage: null,
  },
  {
    id: "pot-2",
    name: "Urlaub",
    priority: 2,
    currentCents: 0,
    targetCents: 200_000,
    ruleType: "fill_to_target",
    fixedMonthlyCents: null,
    remainderPercentage: null,
  },
  {
    id: "pot-3",
    name: "Rücklage",
    priority: 3,
    currentCents: 50_000,
    targetCents: null,
    ruleType: "fixed_monthly",
    fixedMonthlyCents: 25_000,
    remainderPercentage: null,
  },
];

describe("simulateCashflowChangeSeries", () => {
  it("computes totals as exact sum of all pots over horizonMonths + 1", () => {
    const res = simulateCashflowChangeSeries({
      startMonth: "2027-01",
      baseMonthlySurplusCents: 100_000,
      change: { effectiveFromMonth: "2027-03", deltaMonthlyCents: 50_000 },
      pots: samplePots,
      horizonMonths: 12,
    });

    expect(res.months).toHaveLength(13);
    expect(res.months[0]).toBe("2027-01");
    expect(res.months[1]).toBe("2027-01");
    expect(res.months[2]).toBe("2027-02");
    expect(res.baseline.totalCents).toHaveLength(13);
    expect(res.scenario.totalCents).toHaveLength(13);

    for (let t = 0; t <= 12; t++) {
      const baseSum = samplePots.reduce(
        (acc, p) => acc + (res.baseline.byPotId[p.id]?.[t] ?? 0),
        0,
      );
      const scenSum = samplePots.reduce(
        (acc, p) => acc + (res.scenario.byPotId[p.id]?.[t] ?? 0),
        0,
      );
      expect(res.baseline.totalCents[t]).toBe(baseSum);
      expect(res.scenario.totalCents[t]).toBe(scenSum);
    }
  });

  it("matches simulateCashflowChange fill months and deficit months across variants", () => {
    const variants = [
      { base: 80_000, delta: 40_000, from: "2027-03" },
      { base: 80_000, delta: -100_000, from: "2027-02" },
      { base: 80_000, delta: 0, from: "2026-10" }, // effectiveFrom before startMonth
    ];

    for (const v of variants) {
      const input = {
        startMonth: "2027-01",
        baseMonthlySurplusCents: v.base,
        change: { effectiveFromMonth: v.from, deltaMonthlyCents: v.delta },
        pots: samplePots,
        horizonMonths: 24,
      };
      const engine = simulateCashflowChange(input);
      const series = simulateCashflowChangeSeries(input);

      for (const pot of engine.pots) {
        if (!pot.hasTarget || pot.targetCents === null) continue;
        const target = pot.targetCents;
        const firstBaseIdx = (series.baseline.byPotId[pot.potId] ?? []).findIndex(
          (bal) => bal >= target,
        );
        const firstScenIdx = (series.scenario.byPotId[pot.potId] ?? []).findIndex(
          (bal) => bal >= target,
        );
        expect(firstBaseIdx === -1 ? null : firstBaseIdx).toBe(
          pot.baselineMonthsToFill,
        );
        expect(firstScenIdx === -1 ? null : firstScenIdx).toBe(
          pot.scenarioMonthsToFill,
        );
      }

      expect(series.baseline.deficitMonths).toBe(engine.baselineDeficitMonths);
      expect(series.scenario.deficitMonths).toBe(engine.scenarioDeficitMonths);
    }
  });

  it("handles edge cases: zero surplus, deficit without withdrawal, empty pots, already filled", () => {
    const zeroRes = simulateCashflowChangeSeries({
      startMonth: "2027-01",
      baseMonthlySurplusCents: 0,
      change: { effectiveFromMonth: "2027-01", deltaMonthlyCents: 0 },
      pots: samplePots,
      horizonMonths: 6,
    });
    expect(zeroRes.baseline.totalCents.every((v) => v === 150_000)).toBe(true);

    const deficitRes = simulateCashflowChangeSeries({
      startMonth: "2027-01",
      baseMonthlySurplusCents: -50_000,
      change: { effectiveFromMonth: "2027-01", deltaMonthlyCents: -10_000 },
      pots: samplePots,
      horizonMonths: 6,
    });
    expect(deficitRes.baseline.deficitMonths).toBe(6);
    expect(deficitRes.scenario.deficitMonths).toBe(6);
    expect(deficitRes.scenario.totalCents.every((v) => v === 150_000)).toBe(true);

    const emptyRes = simulateCashflowChangeSeries({
      startMonth: "2027-01",
      baseMonthlySurplusCents: 50_000,
      change: { effectiveFromMonth: "2027-01", deltaMonthlyCents: 10_000 },
      pots: [],
      horizonMonths: 4,
    });
    expect(emptyRes.baseline.byPotId).toEqual({});
    expect(emptyRes.baseline.totalCents).toEqual([0, 0, 0, 0, 0]);
  });

  it("throws RangeError on invalid inputs or duplicate pot ids", () => {
    expect(() =>
      simulateCashflowChangeSeries({
        startMonth: "2027-01",
        baseMonthlySurplusCents: 50_000,
        change: { effectiveFromMonth: "2027-01", deltaMonthlyCents: 0 },
        pots: samplePots,
        horizonMonths: 0,
      }),
    ).toThrow(RangeError);

    expect(() =>
      simulateCashflowChangeSeries({
        startMonth: "2027-01",
        baseMonthlySurplusCents: 50_000,
        change: { effectiveFromMonth: "2027-01", deltaMonthlyCents: 0 },
        pots: samplePots,
        horizonMonths: 481,
      }),
    ).toThrow(RangeError);

    expect(() =>
      simulateCashflowChangeSeries({
        startMonth: "2027-01",
        baseMonthlySurplusCents: 50_000,
        change: { effectiveFromMonth: "2027-13", deltaMonthlyCents: 0 },
        pots: samplePots,
        horizonMonths: 12,
      }),
    ).toThrow(RangeError);

    expect(() =>
      simulateCashflowChangeSeries({
        startMonth: "2027-01",
        baseMonthlySurplusCents: 50_000,
        change: { effectiveFromMonth: "2027-01", deltaMonthlyCents: 12.5 },
        pots: samplePots,
        horizonMonths: 12,
      }),
    ).toThrow(RangeError);

    expect(() =>
      simulateCashflowChangeSeries({
        startMonth: "2027-01",
        baseMonthlySurplusCents: 50_000,
        change: { effectiveFromMonth: "2027-01", deltaMonthlyCents: 0 },
        pots: [samplePots[0]!, samplePots[0]!],
        horizonMonths: 12,
      }),
    ).toThrow();
  });
});
