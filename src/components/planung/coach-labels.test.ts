import { describe, expect, it } from "vitest";
import type { InvestmentContext } from "@/lib/domain/investment-context";
import {
  describeRef,
  formatCoverageTenthsDE,
  formatMonthsDE,
} from "./coach-labels";

const ctx = {
  goals: [
    {
      ref: "ZIEL-2",
      purpose: "goal",
      kind: "loan_payoff",
      currentCents: 0,
      targetCents: null,
      horizonMonths: 34,
    },
    {
      ref: "ZIEL-3",
      purpose: "unspecified",
      kind: "general",
      currentCents: 0,
      targetCents: null,
      horizonMonths: null,
    },
  ],
  milestones: [
    {
      ref: "MEILENSTEIN-1",
      category: "loan",
      kind: "fixed_interest_end",
      monthsUntil: 1,
      outstandingBalanceCents: null,
      interestRateBps: null,
    },
  ],
  emergencyFund: {
    configured: true,
    currentCents: 0,
    targetCents: null,
    coverageMonthsTenths: 34,
  },
} as unknown as InvestmentContext;

const labels = { "ZIEL-2": "Muster-Darlehen", "ZIEL-3": "Muster-Urlaub", NOTGROSCHEN: "Notgroschen" };

describe("coach-labels", () => {
  it("formatiert Monate und Abdeckung ganzzahlig", () => {
    expect(formatMonthsDE(1)).toBe("1 Monat");
    expect(formatMonthsDE(34)).toBe("34 Monate");
    expect(formatCoverageTenthsDE(34)).toBe("3,4 Monate");
    expect(formatCoverageTenthsDE(5)).toBe("0,5 Monate");
  });

  it("löst Refs zu lesbaren Labels auf", () => {
    expect(describeRef("ZIEL-2", ctx, labels)).toBe(
      "Muster-Darlehen · Darlehens-Ablösung · 34 Monate",
    );
    expect(describeRef("ZIEL-3", ctx, labels)).toBe("Muster-Urlaub · Allgemeines Ziel");
    expect(describeRef("MEILENSTEIN-1", ctx, labels)).toBe(
      "MEILENSTEIN-1 · Zinsbindungsende · in 1 Monat",
    );
    expect(describeRef("NOTGROSCHEN", ctx, labels)).toBe("Notgroschen · 3,4 Monate");
    expect(describeRef("ETF-1", ctx, {})).toBe("ETF-1");
  });
});
