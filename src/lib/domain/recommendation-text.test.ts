import { describe, expect, it } from "vitest";
import type {
  RecommendationNote,
  RecommendationReason,
} from "@/lib/domain/recommendation";
import {
  formatRecommendationNote,
  formatRecommendationReason,
} from "./recommendation-text";
import { formatRecommendationReason as reExportedReason } from "@/components/planung/recommendation-text";

describe("recommendation-text", () => {
  it("formats every RecommendationReason code into a non-empty German string without Cent", () => {
    const reasons: RecommendationReason[] = [
      {
        code: "EMERGENCY_FUND_GAP",
        targetCents: 750_000,
        currentCents: 200_000,
        months: 3,
        targetSource: "rule",
      },
      { code: "EMERGENCY_FUND_NO_POT" },
      {
        code: "POT_DEADLINE_GAP",
        targetMonth: "2027-06",
        restMonths: 7,
        shortfallAtDeadlineCents: 150_000,
        status: "tight",
      },
      {
        code: "POT_DEADLINE_UNREACHABLE",
        targetMonth: "2027-06",
        remainingGapCents: 50_000,
      },
      {
        code: "PREPAYMENT_BEATS_ETF",
        interestRateBps: 550,
        breakEvenBps: 700,
        expectedReturnBps: 600,
        safetyMarginBps: 100,
      },
      {
        code: "PREPAYMENT_CAP_REACHED",
        capCents: 500_000,
        usedCents: 200_000,
        overflowCents: 300_000,
      },
      { code: "PREPAYMENT_CAP_UNKNOWN" },
      {
        code: "FIXED_INTEREST_ENDS_SOON",
        fixedInterestUntil: "2027-06-01",
        monthsUntil: 6,
        futureRateBps: 450,
      },
      { code: "HORIZON_ESTIMATED", horizonMonths: 120 },
      {
        code: "ETF_BEATS_PREPAYMENT",
        interestRateBps: 150,
        breakEvenBps: 200,
        expectedReturnBps: 600,
        safetyMarginBps: 100,
      },
      { code: "ETF_NO_LOAN" },
      { code: "ETF_AFTER_LOANS" },
      { code: "KEEP_LIQUID_NON_POSITIVE_RETURN", expectedReturnBps: 0 },
      { code: "SURPLUS_BUFFER", bufferBps: 1000 },
      { code: "EMERGENCY_FUND_MONTHLY", gapCents: 300_000, fillMonths: 12 },
      {
        code: "POT_MONTHLY_REQUIRED",
        requiredMonthlyCents: 25_000,
        targetMonth: "2027-06",
      },
      {
        code: "POT_MONTHLY_INSUFFICIENT",
        requiredMonthlyCents: 25_000,
        allocatedCents: 10_000,
        targetMonth: "2027-06",
      },
    ];

    for (const r of reasons) {
      const text = formatRecommendationReason(r);
      expect(text.trim().length).toBeGreaterThan(0);
      expect(text.toLowerCase()).not.toContain("cent");
    }
  });

  it("formats every RecommendationNote code into a non-empty German string without Cent", () => {
    const notes: RecommendationNote[] = [
      { code: "AMOUNT_ZERO" },
      { code: "NO_SURPLUS", surplusCents: -10_000 },
      { code: "EMERGENCY_FUND_FULL", currentCents: 750_000, targetCents: 750_000 },
      { code: "EMERGENCY_TARGET_UNKNOWN" },
      { code: "POT_ON_TRACK", potId: "pot-1", targetMonth: "2027-06" },
      { code: "POT_NO_DEADLINE_SKIPPED", potId: "pot-1" },
      { code: "LOAN_NO_PREPAYMENT_RIGHT", loanId: "loan-1" },
      { code: "LOAN_RATE_BELOW_INTEREST", loanId: "loan-1" },
      { code: "POT_DUE_ONE_TIME", potId: "pot-1", shortfallCents: 50_000 },
    ];
    const labels = {
      potNames: { "pot-1": "Urlaub" },
      loanNames: { "loan-1": "Musterkredit" },
    };

    for (const n of notes) {
      const text = formatRecommendationNote(n, labels);
      expect(text.trim().length).toBeGreaterThan(0);
      expect(text.toLowerCase()).not.toContain("cent");
    }
  });

  it("re-exports formatRecommendationReason from old planung path", () => {
    expect(reExportedReason).toBe(formatRecommendationReason);
  });
});
