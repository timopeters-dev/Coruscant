import { describe, expect, it } from "vitest";
import type { DomainPot } from "./waterfall";
import { balanceAt, simulateMonthlyWaterfall } from "./waterfall-simulation";

describe("simulateMonthlyWaterfall", () => {
  it("records start balances at index 0 and grows target pots monotonically", () => {
    const pots: DomainPot[] = [
      {
        id: "p1",
        name: "Topf Musterziel",
        priority: 1,
        currentCents: 100_000,
        targetCents: 350_000,
        ruleType: "fill_to_target",
      },
      {
        id: "p2",
        name: "Topf Musterreserve",
        priority: 2,
        currentCents: 0,
        targetCents: 200_000,
        ruleType: "fill_to_target",
      },
    ];

    const result = simulateMonthlyWaterfall(pots, 6, () => 100_000);
    expect(result.simulatedMonths).toBe(6);
    expect(result.deficitMonths).toBe(0);
    expect(result.fillMonthIndex.get("p1")).toBe(3);
    expect(result.fillMonthIndex.get("p2")).toBe(5);

    const s1 = result.balancesByPotId.get("p1")!;
    const s2 = result.balancesByPotId.get("p2")!;
    expect(s1).toEqual([100_000, 200_000, 300_000, 350_000, 350_000, 350_000, 350_000]);
    expect(s2).toEqual([0, 0, 0, 50_000, 150_000, 200_000, 200_000]);

    for (let i = 1; i < s1.length; i += 1) {
      expect(s1[i]!).toBeGreaterThanOrEqual(s1[i - 1]!);
      expect(s2[i]!).toBeGreaterThanOrEqual(s2[i - 1]!);
    }
  });

  it("stops early via stopWhen and balanceAt returns last value after stop", () => {
    const pots: DomainPot[] = [
      {
        id: "p1",
        name: "Topf Musterziel",
        priority: 1,
        currentCents: 0,
        targetCents: 200_000,
        ruleType: "fill_to_target",
      },
    ];

    const result = simulateMonthlyWaterfall(pots, 12, () => 100_000, {
      stopWhen: ({ fillMonthIndex }) => fillMonthIndex.has("p1"),
    });

    expect(result.simulatedMonths).toBe(2);
    expect(balanceAt(result, "p1", 0)).toBe(0);
    expect(balanceAt(result, "p1", 1)).toBe(100_000);
    expect(balanceAt(result, "p1", 2)).toBe(200_000);
    expect(balanceAt(result, "p1", 10)).toBe(200_000);
    expect(balanceAt(result, "p1", 12)).toBe(200_000);
  });

  it("counts deficit months before and after early stop without negative allocation", () => {
    const pots: DomainPot[] = [
      {
        id: "p1",
        name: "Topf Musterziel",
        priority: 1,
        currentCents: 0,
        targetCents: 100_000,
        ruleType: "fill_to_target",
      },
    ];

    const surpluses = [-50_000, 100_000, -10_000, 20_000, -5_000];
    const result = simulateMonthlyWaterfall(
      pots,
      5,
      (m) => surpluses[m - 1] ?? 0,
      { stopWhen: ({ fillMonthIndex }) => fillMonthIndex.has("p1") },
    );

    expect(result.simulatedMonths).toBe(2);
    expect(result.fillMonthIndex.get("p1")).toBe(2);
    expect(result.deficitMonths).toBe(3);
  });

  it("rejects unknown potId or negative t in balanceAt", () => {
    const pots: DomainPot[] = [
      {
        id: "p1",
        name: "Topf Musterziel",
        priority: 1,
        currentCents: 0,
        targetCents: 100_000,
        ruleType: "fill_to_target",
      },
    ];
    const result = simulateMonthlyWaterfall(pots, 1, () => 50_000);
    expect(() => balanceAt(result, "missing", 0)).toThrow(RangeError);
    expect(() => balanceAt(result, "p1", -1)).toThrow(RangeError);
  });
});
