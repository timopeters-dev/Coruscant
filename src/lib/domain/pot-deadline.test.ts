import { describe, expect, it } from "vitest";
import {
  calculateRequiredMonthlyCents,
  countRemainingMonths,
  DEADLINE_ON_TRACK_BUFFER_MONTHS,
  evaluatePotDeadlines,
  MAX_POT_DEADLINE_MONTHS,
  summarizeDeadlineRisks,
  type DeadlinePotInput,
  type PotDeadlineEvaluation,
} from "./pot-deadline";
import { applyPendingTransfers } from "./pot-sync";

describe("countRemainingMonths", () => {
  it("counts remaining months excluding current month and including target month", () => {
    expect(countRemainingMonths("2026-11-18", "2027-03-31")).toBe(4);
    expect(countRemainingMonths("2026-11-01", "2026-11-30")).toBe(0);
    expect(countRemainingMonths("2026-12-01", "2027-01-01")).toBe(1);
    expect(countRemainingMonths("2026-11-18", "2026-10-15")).toBe(0);
  });

  it("throws RangeError on invalid ISO date", () => {
    expect(() => countRemainingMonths("2026-11-18", "2027-02-30")).toThrow(
      RangeError,
    );
    expect(() => countRemainingMonths("2026-02-29", "2027-03-01")).toThrow(
      RangeError,
    );
  });
});

describe("calculateRequiredMonthlyCents", () => {
  it("computes exact and ceiling division using BigInt", () => {
    expect(calculateRequiredMonthlyCents(120_000, 12)).toBe(10_000);
    expect(calculateRequiredMonthlyCents(100_001, 3)).toBe(33_334);
    expect(calculateRequiredMonthlyCents(1, 12)).toBe(1);
    expect(calculateRequiredMonthlyCents(0, 12)).toBe(0);
    expect(calculateRequiredMonthlyCents(50_000, 0)).toBe(50_000);
  });

  it("handles large values near MAX_SAFE_INTEGER without float precision loss", () => {
    const large = Number.MAX_SAFE_INTEGER - 2; // 9007199254740989 = 3 * 3002399751580329 + 2
    // ceil(9007199254740989 / 3) = 3002399751580330
    expect(calculateRequiredMonthlyCents(large, 3)).toBe(3_002_399_751_580_330);
    // 9007199254740991 = 3 * 3002399751580330 + 1 -> ceil = 3002399751580331
    // (float (MAX_SAFE_INTEGER + 2) would round and lose precision)
    expect(calculateRequiredMonthlyCents(Number.MAX_SAFE_INTEGER, 3)).toBe(
      3_002_399_751_580_331,
    );
  });

  it("rejects negative or non-integer inputs", () => {
    expect(() => calculateRequiredMonthlyCents(-1, 5)).toThrow(RangeError);
    expect(() => calculateRequiredMonthlyCents(100, -1)).toThrow(RangeError);
    expect(() => calculateRequiredMonthlyCents(10.5, 2)).toThrow(RangeError);
    expect(() => calculateRequiredMonthlyCents(100, 1.5)).toThrow(RangeError);
  });
});

describe("evaluatePotDeadlines", () => {
  it("evaluates fill_to_target happy path", () => {
    const pots: DeadlinePotInput[] = [
      {
        id: "p1",
        name: "Topf Musterziel",
        priority: 1,
        currentCents: 100_000,
        targetCents: 400_000,
        ruleType: "fill_to_target",
        targetDate: "2027-05-31", // 6 months from 2026-11
      },
    ];

    const [ev] = evaluatePotDeadlines({
      pots,
      monthlySurplusCents: 100_000,
      todayIsoDate: "2026-11-18",
    });

    expect(ev).toMatchObject({
      potId: "p1",
      targetMonth: "2027-05",
      status: "on_track",
      restMonths: 6,
      shortfallNowCents: 300_000,
      requiredMonthlyCents: 50_000,
      requiredIsOneTime: false,
      plannedMonthlyCents: 50_000,
      projectedAtDeadlineCents: 400_000,
      shortfallAtDeadlineCents: 0,
      expectedReachMonth: "2027-02",
      monthsBuffer: 3,
    });
  });

  it("simulates lower-priority fill_to_target behind higher-priority pot (average Ist-Rate > 0)", () => {
    const pots: DeadlinePotInput[] = [
      {
        id: "p1",
        name: "Topf Muster-Prio1",
        priority: 1,
        currentCents: 0,
        targetCents: 200_000,
        ruleType: "fill_to_target",
        // no targetDate
      },
      {
        id: "p2",
        name: "Topf Musterziel",
        priority: 2,
        currentCents: 0,
        targetCents: 400_000,
        ruleType: "fill_to_target",
        targetDate: "2027-08-31", // 9 months from 2026-11
      },
    ];

    // Surplus 100k/mo: p1 fills in months 1-2 (200k), p2 gets 100k/mo in months 3-6 (400k -> filled at month 6).
    // restMonths = 9, fillMonth = 6 -> buffer = 3 -> on_track; average over 9 months = floor(400_000 / 9) = 44_444.
    const evals = evaluatePotDeadlines({
      pots,
      monthlySurplusCents: 100_000,
      todayIsoDate: "2026-11-18",
    });
    expect(evals).toHaveLength(1);
    expect(evals[0]).toMatchObject({
      potId: "p2",
      status: "on_track",
      restMonths: 9,
      plannedMonthlyCents: 44_444,
      projectedAtDeadlineCents: 400_000,
      shortfallAtDeadlineCents: 0,
      expectedReachMonth: "2027-05",
      monthsBuffer: 3,
    });
  });

  it("evaluates fixed_monthly across on_track, tight, and at_risk", () => {
    const base: Omit<DeadlinePotInput, "targetDate"> = {
      id: "p1",
      name: "Topf Muster-Fest",
      priority: 1,
      currentCents: 0,
      targetCents: 300_000,
      ruleType: "fixed_monthly",
      fixedMonthlyCents: 100_000,
    };

    // Fills at month 3.
    const [onTrack] = evaluatePotDeadlines({
      pots: [{ ...base, targetDate: "2027-05-31" }], // R=6, buffer=3
      monthlySurplusCents: 200_000,
      todayIsoDate: "2026-11-18",
    });
    expect(onTrack!.status).toBe("on_track");

    const [tight] = evaluatePotDeadlines({
      pots: [{ ...base, targetDate: "2027-04-30" }], // R=5, buffer=2
      monthlySurplusCents: 200_000,
      todayIsoDate: "2026-11-18",
    });
    expect(tight!.status).toBe("tight");
    expect(tight!.monthsBuffer).toBe(2);

    const [atRisk] = evaluatePotDeadlines({
      pots: [{ ...base, targetDate: "2027-01-31" }], // R=2, projected=200k, shortfall=100k
      monthlySurplusCents: 200_000,
      todayIsoDate: "2026-11-18",
    });
    expect(atRisk).toMatchObject({
      status: "at_risk",
      projectedAtDeadlineCents: 200_000,
      shortfallAtDeadlineCents: 100_000,
      expectedReachMonth: "2027-02",
      monthsBuffer: null,
    });
  });

  it("evaluates percentage_of_remainder including Hamilton cent distribution", () => {
    const pots: DeadlinePotInput[] = [
      {
        id: "p1",
        name: "Topf A",
        priority: 1,
        currentCents: 0,
        targetCents: 101,
        ruleType: "percentage_of_remainder",
        remainderPercentage: 50,
        targetDate: "2027-01-31", // R=2
      },
      {
        id: "p2",
        name: "Topf B",
        priority: 2,
        currentCents: 0,
        targetCents: 100,
        ruleType: "percentage_of_remainder",
        remainderPercentage: 50,
      },
    ];

    // Surplus 101/mo: each month p1 gets 51 (remainder 50.5 -> tie broken by priority -> p1 gets 51, p2 gets 50).
    // Month 1: p1 = 51. Month 2: p1 headroom = 50, allocated = 50 -> p1 reaches 101 in month 2!
    const [ev] = evaluatePotDeadlines({
      pots,
      monthlySurplusCents: 101,
      todayIsoDate: "2026-11-18",
    });
    expect(ev).toMatchObject({
      potId: "p1",
      status: "tight",
      restMonths: 2,
      monthsBuffer: 0,
      projectedAtDeadlineCents: 101,
      expectedReachMonth: "2027-01",
    });
  });

  it("respects the 3-month buffer boundary exactly", () => {
    const pot = (targetDate: string): DeadlinePotInput => ({
      id: "p1",
      name: "Topf Puffer",
      priority: 1,
      currentCents: 0,
      targetCents: 100_000,
      ruleType: "fill_to_target",
      targetDate,
    });

    // Fills in month 1 (2026-12) with 100k surplus.
    expect(
      evaluatePotDeadlines({
        pots: [pot("2027-03-31")], // R=4, buffer=3
        monthlySurplusCents: 100_000,
        todayIsoDate: "2026-11-18",
      })[0]!.status,
    ).toBe(DEADLINE_ON_TRACK_BUFFER_MONTHS === 3 ? "on_track" : "tight");

    expect(
      evaluatePotDeadlines({
        pots: [pot("2027-02-28")], // R=3, buffer=2
        monthlySurplusCents: 100_000,
        todayIsoDate: "2026-11-18",
      })[0]!.status,
    ).toBe("tight");

    expect(
      evaluatePotDeadlines({
        pots: [pot("2026-12-31")], // R=1, buffer=0
        monthlySurplusCents: 100_000,
        todayIsoDate: "2026-11-18",
      })[0]!.status,
    ).toBe("tight");

    expect(
      evaluatePotDeadlines({
        pots: [pot("2026-12-31")], // R=1, fills at month 2 (50k/mo) -> 1 month late
        monthlySurplusCents: 50_000,
        todayIsoDate: "2026-11-18",
      })[0]!.status,
    ).toBe("at_risk");
  });

  it("handles overdue, current-month, reached, overpaid, and 0-target edge cases", () => {
    const pots: DeadlinePotInput[] = [
      {
        id: "overdue-unreached",
        name: "Topf Verstrichen",
        priority: 1,
        currentCents: 20_000,
        targetCents: 100_000,
        ruleType: "fill_to_target",
        targetDate: "2026-10-31",
      },
      {
        id: "overdue-reached",
        name: "Topf Verstrichen Voll",
        priority: 2,
        currentCents: 100_000,
        targetCents: 100_000,
        ruleType: "fill_to_target",
        targetDate: "2026-10-31",
      },
      {
        id: "current-month-shortfall",
        name: "Topf Laufender Monat",
        priority: 3,
        currentCents: 40_000,
        targetCents: 100_000,
        ruleType: "fill_to_target",
        targetDate: "2026-11-30",
      },
      {
        id: "current-month-reached",
        name: "Topf Laufender Monat Voll",
        priority: 4,
        currentCents: 100_000,
        targetCents: 100_000,
        ruleType: "fill_to_target",
        targetDate: "2026-11-30",
      },
      {
        id: "overpaid",
        name: "Topf Überzahlt",
        priority: 5,
        currentCents: 150_000,
        targetCents: 100_000,
        ruleType: "fill_to_target",
        targetDate: "2027-06-30",
      },
      {
        id: "zero-target",
        name: "Topf Nullziel",
        priority: 6,
        currentCents: 0,
        targetCents: 0,
        ruleType: "fill_to_target",
        targetDate: "2027-06-30",
      },
    ];

    const evals = evaluatePotDeadlines({
      pots,
      monthlySurplusCents: 50_000,
      todayIsoDate: "2026-11-18",
    });

    expect(evals.map((e) => e.potId)).toEqual([
      "overdue-unreached",
      "overdue-reached",
      "current-month-shortfall",
      "current-month-reached",
      "overpaid",
      "zero-target",
    ]);

    expect(evals[0]).toMatchObject({
      status: "overdue",
      restMonths: 0,
      requiredMonthlyCents: 80_000,
      requiredIsOneTime: true,
      plannedMonthlyCents: null,
    });
    expect(evals[1]).toMatchObject({
      status: "reached",
      requiredMonthlyCents: 0,
      requiredIsOneTime: false,
    });
    expect(evals[2]).toMatchObject({
      status: "at_risk",
      restMonths: 0,
      requiredMonthlyCents: 60_000,
      requiredIsOneTime: true,
      plannedMonthlyCents: null,
    });
    expect(evals[3]).toMatchObject({
      status: "reached",
      requiredMonthlyCents: 0,
    });
    expect(evals[4]).toMatchObject({
      status: "reached",
      shortfallNowCents: 0,
      requiredMonthlyCents: 0,
      projectedAtDeadlineCents: 100_000,
      shortfallAtDeadlineCents: 0,
    });
    expect(evals[5]).toMatchObject({
      status: "reached",
      requiredMonthlyCents: 0,
    });
  });

  it("handles zero/negative surplus and unreachable within 480 months", () => {
    const pots: DeadlinePotInput[] = [
      {
        id: "p1",
        name: "Topf Musterziel",
        priority: 1,
        currentCents: 0,
        targetCents: 100_000,
        ruleType: "fill_to_target",
        targetDate: "2027-05-31",
      },
    ];

    const [zero] = evaluatePotDeadlines({
      pots,
      monthlySurplusCents: 0,
      todayIsoDate: "2026-11-18",
    });
    expect(zero).toMatchObject({
      status: "at_risk",
      plannedMonthlyCents: 0,
      expectedReachMonth: null,
    });

    const [neg] = evaluatePotDeadlines({
      pots,
      monthlySurplusCents: -50_000,
      todayIsoDate: "2026-11-18",
    });
    expect(neg).toMatchObject({
      status: "at_risk",
      plannedMonthlyCents: 0,
      expectedReachMonth: null,
    });

    // Unreachable within 480 months (100 cents/month vs 100_000_000 cents target = 1_000_000 months)
    const [far] = evaluatePotDeadlines({
      pots: [
        {
          id: "far",
          name: "Topf Langfrist",
          priority: 1,
          currentCents: 0,
          targetCents: 100_000_000,
          ruleType: "fixed_monthly",
          fixedMonthlyCents: 100,
          targetDate: "2030-11-30",
        },
      ],
      monthlySurplusCents: 10_000,
      todayIsoDate: "2026-11-18",
    });
    expect(MAX_POT_DEADLINE_MONTHS).toBe(480);
    expect(far!.expectedReachMonth).toBeNull();
    expect(far!.status).toBe("at_risk");
  });

  it("caps fixed_monthly pot at targetCents and supports applyPendingTransfers without double counting", () => {
    const pots: DeadlinePotInput[] = [
      {
        id: "linked",
        name: "Muster-Tagesgeld",
        priority: 1,
        currentCents: 250_000,
        targetCents: 300_000,
        ruleType: "fixed_monthly",
        fixedMonthlyCents: 100_000,
        targetDate: "2027-05-31",
      },
    ];

    const withPending = applyPendingTransfers(pots, new Map([["linked", 50_000]]));
    const [ev] = evaluatePotDeadlines({
      pots: withPending,
      monthlySurplusCents: 200_000,
      todayIsoDate: "2026-11-18",
    });
    expect(ev!.status).toBe("reached");
    expect(ev!.projectedAtDeadlineCents).toBe(300_000);

    // Without pending transfer, projected is capped at targetCents (300_000, never 350_000).
    const [evNoPending] = evaluatePotDeadlines({
      pots,
      monthlySurplusCents: 200_000,
      todayIsoDate: "2026-11-18",
    });
    expect(evNoPending!.projectedAtDeadlineCents).toBe(300_000);
  });

  it("throws RangeError if targetDate is set without targetCents", () => {
    expect(() =>
      evaluatePotDeadlines({
        pots: [
          {
            id: "bad",
            name: "Topf Ohne Ziel",
            priority: 1,
            currentCents: 0,
            targetCents: null,
            ruleType: "fixed_monthly",
            fixedMonthlyCents: 10_000,
            targetDate: "2027-05-31",
          },
        ],
        monthlySurplusCents: 50_000,
        todayIsoDate: "2026-11-18",
      }),
    ).toThrow(RangeError);
  });
});

describe("summarizeDeadlineRisks", () => {
  it("counts risks and picks worst (at_risk before overdue, then earliest date, then potId)", () => {
    expect(summarizeDeadlineRisks([])).toEqual({
      atRiskCount: 0,
      overdueCount: 0,
      tightCount: 0,
      worst: null,
    });

    const mk = (
      potId: string,
      status: PotDeadlineEvaluation["status"],
      targetDate: string,
    ): PotDeadlineEvaluation => ({
      potId,
      potName: `Topf ${potId}`,
      targetDate,
      targetMonth: targetDate.slice(0, 7),
      targetCents: 100_000,
      currentCents: 0,
      status,
      restMonths: 1,
      shortfallNowCents: 100_000,
      requiredMonthlyCents: 100_000,
      requiredIsOneTime: false,
      plannedMonthlyCents: 0,
      projectedAtDeadlineCents: 0,
      shortfallAtDeadlineCents: 100_000,
      expectedReachMonth: null,
      monthsBuffer: null,
    });

    const summary = summarizeDeadlineRisks([
      mk("p-tight", "tight", "2027-01-01"),
      mk("p-overdue", "overdue", "2026-10-01"),
      mk("p-risk-b", "at_risk", "2027-02-01"),
      mk("p-risk-a", "at_risk", "2027-02-01"),
    ]);

    expect(summary.atRiskCount).toBe(2);
    expect(summary.overdueCount).toBe(1);
    expect(summary.tightCount).toBe(1);
    expect(summary.worst?.potId).toBe("p-risk-a");
  });
});
