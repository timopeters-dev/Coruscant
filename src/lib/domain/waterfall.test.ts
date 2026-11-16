import { describe, expect, it } from "vitest";
import {
  calculatePotHeadroomCents,
  calculateWaterfallSuggestion,
  type DomainPot,
  validateManualWaterfallAllocation,
} from "./waterfall";

function makePots(): DomainPot[] {
  return [
    {
      id: "pot-notgroschen",
      name: "Notgroschen",
      priority: 1,
      currentCents: 80_000,
      targetCents: 100_000,
      ruleType: "fill_to_target",
    },
    {
      id: "pot-urlaub",
      name: "Urlaub",
      priority: 2,
      currentCents: 50_000,
      targetCents: 200_000,
      ruleType: "fixed_monthly",
      fixedMonthlyCents: 30_000,
    },
    {
      id: "pot-sondertilgung",
      name: "Sondertilgung",
      priority: 3,
      currentCents: 0,
      targetCents: null,
      ruleType: "percentage_of_remainder",
      remainderPercentage: 60,
    },
    {
      id: "pot-etf",
      name: "Haushalts-Rücklage",
      priority: 4,
      currentCents: 0,
      targetCents: null,
      ruleType: "percentage_of_remainder",
      remainderPercentage: 40,
    },
  ];
}

describe("calculatePotHeadroomCents", () => {
  it("returns remaining headroom or null when no target is set", () => {
    expect(
      calculatePotHeadroomCents({
        id: "a",
        name: "A",
        priority: 1,
        currentCents: 120_000,
        targetCents: 100_000,
        ruleType: "fill_to_target",
      }),
    ).toBe(0);
    expect(
      calculatePotHeadroomCents({
        id: "b",
        name: "B",
        priority: 1,
        currentCents: 50_000,
        targetCents: null,
        ruleType: "percentage_of_remainder",
        remainderPercentage: 100,
      }),
    ).toBeNull();
  });
});

describe("calculateWaterfallSuggestion", () => {
  it("distributes across all 3 rule types in monthly mode", () => {
    const plan = calculateWaterfallSuggestion(makePots(), 150_000, {
      mode: "monthly",
    });

    // Notgroschen needs 20_000; Urlaub takes 30_000; remaining = 100_000 (60k / 40k)
    expect(plan.totalAllocatedCents).toBe(150_000);
    expect(plan.unallocatedCents).toBe(0);
    expect(plan.suggestions.map((s) => s.allocatedCents)).toEqual([
      20_000,
      30_000,
      60_000,
      40_000,
    ]);
  });

  it("skips fixed_monthly pots in one_time mode", () => {
    const plan = calculateWaterfallSuggestion(makePots(), 120_000, {
      mode: "one_time",
    });

    // Notgroschen needs 20_000; Urlaub skipped (0); remaining 100_000 -> 60k / 40k
    expect(plan.totalAllocatedCents).toBe(120_000);
    expect(plan.unallocatedCents).toBe(0);
    expect(plan.suggestions.map((s) => s.allocatedCents)).toEqual([
      20_000,
      0,
      60_000,
      40_000,
    ]);
  });

  it("distributes remainder cents accurately via Hamilton method with priority tie-breaker", () => {
    const pots: DomainPot[] = [
      {
        id: "p1",
        name: "P1",
        priority: 1,
        currentCents: 0,
        targetCents: null,
        ruleType: "percentage_of_remainder",
        remainderPercentage: 33,
      },
      {
        id: "p2",
        name: "P2",
        priority: 2,
        currentCents: 0,
        targetCents: null,
        ruleType: "percentage_of_remainder",
        remainderPercentage: 33,
      },
      {
        id: "p3",
        name: "P3",
        priority: 3,
        currentCents: 0,
        targetCents: null,
        ruleType: "percentage_of_remainder",
        remainderPercentage: 34,
      },
    ];

    const plan10 = calculateWaterfallSuggestion(pots, 10);
    // 3.3 -> 3, 3.3 -> 3, 3.4 -> 4 => total 10
    expect(plan10.suggestions.map((s) => s.allocatedCents)).toEqual([3, 3, 4]);
    expect(plan10.totalAllocatedCents + plan10.unallocatedCents).toBe(10);

    const tiePots: DomainPot[] = [
      {
        id: "a",
        name: "A",
        priority: 1,
        currentCents: 0,
        targetCents: null,
        ruleType: "percentage_of_remainder",
        remainderPercentage: 50,
      },
      {
        id: "b",
        name: "B",
        priority: 2,
        currentCents: 0,
        targetCents: null,
        ruleType: "percentage_of_remainder",
        remainderPercentage: 50,
      },
    ];
    const plan1 = calculateWaterfallSuggestion(tiePots, 1);
    expect(plan1.suggestions.map((s) => s.allocatedCents)).toEqual([1, 0]);
    expect(plan1.unallocatedCents).toBe(0);
  });

  it("prevents target overpayment and puts unallocated excess into unallocatedCents", () => {
    const pots: DomainPot[] = [
      {
        id: "full",
        name: "Voll",
        priority: 1,
        currentCents: 100_000,
        targetCents: 100_000,
        ruleType: "fill_to_target",
      },
      {
        id: "pct-capped",
        name: "Gedeckelt",
        priority: 2,
        currentCents: 90_000,
        targetCents: 100_000,
        ruleType: "percentage_of_remainder",
        remainderPercentage: 80,
      },
    ];

    const plan = calculateWaterfallSuggestion(pots, 50_000);
    expect(plan.suggestions[0]?.allocatedCents).toBe(0);
    expect(plan.suggestions[1]?.allocatedCents).toBe(10_000);
    expect(plan.suggestions[1]?.cappedByTarget).toBe(true);
    expect(plan.unallocatedCents).toBe(40_000);
    expect(plan.totalAllocatedCents + plan.unallocatedCents).toBe(50_000);
  });

  it("returns 0 allocations for 0 distributable cents", () => {
    const plan = calculateWaterfallSuggestion(makePots(), 0);
    expect(plan.totalAllocatedCents).toBe(0);
    expect(plan.unallocatedCents).toBe(0);
    expect(plan.suggestions.every((s) => s.allocatedCents === 0)).toBe(true);
  });

  it("throws RangeError on invalid rules, duplicate IDs, >100% sum, or negative/float amounts", () => {
    expect(() => calculateWaterfallSuggestion(makePots(), -1)).toThrow(
      RangeError,
    );
    expect(() => calculateWaterfallSuggestion(makePots(), 10.5)).toThrow(
      RangeError,
    );
    expect(() =>
      calculateWaterfallSuggestion(
        [
          {
            id: "dup",
            name: "A",
            priority: 1,
            currentCents: 0,
            targetCents: 100,
            ruleType: "fill_to_target",
          },
          {
            id: "dup",
            name: "B",
            priority: 2,
            currentCents: 0,
            targetCents: 100,
            ruleType: "fill_to_target",
          },
        ],
        100,
      ),
    ).toThrow(RangeError);
    expect(() =>
      calculateWaterfallSuggestion(
        [
          {
            id: "no-target",
            name: "Missing target",
            priority: 1,
            currentCents: 0,
            targetCents: null,
            ruleType: "fill_to_target",
          },
        ],
        100,
      ),
    ).toThrow(RangeError);
    expect(() =>
      calculateWaterfallSuggestion(
        [
          {
            id: "p1",
            name: "P1",
            priority: 1,
            currentCents: 0,
            targetCents: null,
            ruleType: "percentage_of_remainder",
            remainderPercentage: 60,
          },
          {
            id: "p2",
            name: "P2",
            priority: 2,
            currentCents: 0,
            targetCents: null,
            ruleType: "percentage_of_remainder",
            remainderPercentage: 41,
          },
        ],
        100,
      ),
    ).toThrow(RangeError);
  });
});

describe("validateManualWaterfallAllocation", () => {
  it("validates partial and full manual allocations without over-target warnings", () => {
    const pots = makePots();

    const partial = validateManualWaterfallAllocation(pots, 100_000, [
      { potId: "pot-notgroschen", allocatedCents: 20_000 },
      { potId: "pot-urlaub", allocatedCents: 30_000 },
    ]);
    expect(partial.totalAllocatedCents).toBe(50_000);
    expect(partial.unallocatedCents).toBe(50_000);
    expect(partial.exceedsInput).toBe(false);
    expect(partial.hasPositiveAllocation).toBe(true);
    expect(partial.overTargetWarnings).toEqual([]);
    expect(partial.projectedByPotId["pot-notgroschen"]).toBe(100_000);
    expect(partial.projectedByPotId["pot-urlaub"]).toBe(80_000);
    expect(partial.projectedByPotId["pot-sondertilgung"]).toBe(0);

    const full = validateManualWaterfallAllocation(pots, 50_000, [
      { potId: "pot-notgroschen", allocatedCents: 20_000 },
      { potId: "pot-urlaub", allocatedCents: 30_000 },
    ]);
    expect(full.totalAllocatedCents).toBe(50_000);
    expect(full.unallocatedCents).toBe(0);
    expect(full.exceedsInput).toBe(false);
    expect(full.overTargetWarnings).toEqual([]);
  });

  it("flags input exceedance, zero allocations, and over-target warnings", () => {
    const pots = makePots();

    const overInput = validateManualWaterfallAllocation(pots, 40_000, [
      { potId: "pot-notgroschen", allocatedCents: 30_000 },
      { potId: "pot-urlaub", allocatedCents: 20_000 },
    ]);
    expect(overInput.totalAllocatedCents).toBe(50_000);
    expect(overInput.unallocatedCents).toBe(-10_000);
    expect(overInput.exceedsInput).toBe(true);
    expect(overInput.hasPositiveAllocation).toBe(true);
    expect(overInput.overTargetWarnings).toEqual([
      {
        potId: "pot-notgroschen",
        potName: "Notgroschen",
        excessCents: 10_000,
      },
    ]);

    const allZero = validateManualWaterfallAllocation(pots, 40_000, [
      { potId: "pot-notgroschen", allocatedCents: 0 },
      { potId: "pot-urlaub", allocatedCents: 0 },
    ]);
    expect(allZero.totalAllocatedCents).toBe(0);
    expect(allZero.unallocatedCents).toBe(40_000);
    expect(allZero.exceedsInput).toBe(false);
    expect(allZero.hasPositiveAllocation).toBe(false);
  });

  it("throws RangeError on duplicate potIds, unknown potIds, negative or float amounts", () => {
    const pots = makePots();

    expect(() =>
      validateManualWaterfallAllocation(pots, 10_000, [
        { potId: "pot-notgroschen", allocatedCents: 1_000 },
        { potId: "pot-notgroschen", allocatedCents: 2_000 },
      ]),
    ).toThrow(RangeError);

    expect(() =>
      validateManualWaterfallAllocation(pots, 10_000, [
        { potId: "pot-unknown", allocatedCents: 1_000 },
      ]),
    ).toThrow(RangeError);

    expect(() =>
      validateManualWaterfallAllocation(pots, -1, []),
    ).toThrow(RangeError);

    expect(() =>
      validateManualWaterfallAllocation(pots, 10_000, [
        { potId: "pot-notgroschen", allocatedCents: 10.5 },
      ]),
    ).toThrow(RangeError);

    expect(() =>
      validateManualWaterfallAllocation(pots, 10_000, [
        { potId: "pot-notgroschen", allocatedCents: -100 },
      ]),
    ).toThrow(RangeError);
  });
});
