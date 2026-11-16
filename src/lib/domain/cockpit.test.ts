import { describe, expect, it } from "vitest";
import {
  selectTopPotProgress,
  selectUpcomingActiveMilestones,
} from "./cockpit";
import type { DomainContract } from "./contracts";
import type { DomainPot } from "./waterfall";

describe("selectUpcomingActiveMilestones", () => {
  const baseContract: Omit<
    DomainContract,
    "id" | "name" | "status" | "milestoneDate" | "milestoneLabel" | "fixedInterestUntil"
  > = {
    sphere: "household",
    category: "loan",
    currentBalanceCents: 5_000_000,
    balanceAsOfDate: "2026-11-01",
    monthlyRateCents: 50_000,
    interestRateBps: 350,
    repaymentType: "annuity",
  };

  it("excludes paused and closed contracts, sorts chronologically, caps at limit, and counts overdue", () => {
    const contracts: DomainContract[] = [
      {
        ...baseContract,
        id: "c-paused",
        name: "Musterbank Pausiert",
        status: "paused",
        milestoneDate: "2026-11-10",
        milestoneLabel: "Pausierter Termin",
        fixedInterestUntil: null,
      },
      {
        ...baseContract,
        id: "c-closed",
        name: "Musterbank Geschlossen",
        status: "closed",
        milestoneDate: "2026-11-05",
        milestoneLabel: "Alter Termin",
        fixedInterestUntil: null,
      },
      {
        ...baseContract,
        id: "c-active-1",
        name: "Musterbank Kredit A",
        status: "active",
        milestoneDate: "2026-11-12",
        milestoneLabel: "Sondertilgung",
        fixedInterestUntil: "2027-03-01",
      },
      {
        ...baseContract,
        id: "c-active-2",
        name: "Musterbank Kredit B",
        status: "active",
        milestoneDate: "2026-11-20",
        milestoneLabel: "Rate prüfen",
        fixedInterestUntil: "2028-01-15",
      },
      {
        ...baseContract,
        id: "c-active-3",
        name: "Musterbank Bausparer",
        status: "active",
        milestoneDate: "2026-11-01",
        milestoneLabel: "Zuteilung",
        fixedInterestUntil: "2026-12-01",
      },
    ];

    const result = selectUpcomingActiveMilestones(contracts, "2026-11-16", 4);

    expect(result.totalCount).toBe(6);
    expect(result.overdueCount).toBe(2);
    expect(result.items).toHaveLength(4);
    expect(result.items.map((item) => item.date)).toEqual([
      "2026-11-01",
      "2026-11-12",
      "2026-11-20",
      "2026-12-01",
    ]);
    expect(result.items[0]?.isOverdue).toBe(true);
    expect(result.items[2]?.isOverdue).toBe(false);
  });

  it("throws RangeError on invalid referenceDate or negative limit", () => {
    expect(() => selectUpcomingActiveMilestones([], "2026-02-29", 5)).toThrow(
      RangeError,
    );
    expect(() => selectUpcomingActiveMilestones([], "2026-11-16", -1)).toThrow(
      RangeError,
    );
  });
});

describe("selectTopPotProgress", () => {
  const pots: DomainPot[] = [
    {
      id: "pot-4",
      name: "Urlaub",
      priority: 4,
      currentCents: 100_000,
      targetCents: 200_000,
      ruleType: "fixed_monthly",
      fixedMonthlyCents: 20_000,
    },
    {
      id: "pot-2",
      name: "Sondertilgung",
      priority: 2,
      currentCents: 350_000,
      targetCents: 300_000,
      ruleType: "fill_to_target",
    },
    {
      id: "pot-1",
      name: "Notgroschen",
      priority: 1,
      currentCents: 500_000,
      targetCents: 1_000_000,
      ruleType: "fill_to_target",
    },
    {
      id: "pot-3",
      name: "Instandhaltung Musterstraße 1",
      priority: 3,
      currentCents: 250_000,
      targetCents: null,
      ruleType: "percentage_of_remainder",
      remainderPercentage: 50,
    },
  ];

  it("sorts by priority ASC, caps at 3, and handles over-funded & targetless pots", () => {
    const result = selectTopPotProgress(pots, 3);

    expect(result.map((p) => p.id)).toEqual(["pot-1", "pot-2", "pot-3"]);

    expect(result[0]).toMatchObject({
      progressBps: 5_000,
      cappedProgressBps: 5_000,
      remainingCents: 500_000,
      isTargetReached: false,
    });

    expect(result[1]).toMatchObject({
      progressBps: 11_667,
      cappedProgressBps: 10_000,
      remainingCents: 0,
      isTargetReached: true,
    });

    expect(result[2]).toMatchObject({
      progressBps: null,
      cappedProgressBps: null,
      remainingCents: null,
      isTargetReached: false,
    });
  });

  it("handles targetCents === 0 cleanly and rejects negative currentCents", () => {
    const zeroTarget = selectTopPotProgress([
      {
        id: "pot-zero",
        name: "Null-Ziel",
        priority: 1,
        currentCents: 10_000,
        targetCents: 0,
        ruleType: "fill_to_target",
      },
    ]);

    expect(zeroTarget[0]).toMatchObject({
      progressBps: null,
      cappedProgressBps: null,
      remainingCents: 0,
      isTargetReached: false,
    });

    expect(() =>
      selectTopPotProgress([
        {
          id: "pot-neg",
          name: "Ungültig",
          priority: 1,
          currentCents: -1,
          targetCents: 10_000,
          ruleType: "fill_to_target",
        },
      ]),
    ).toThrow(RangeError);
  });
});
