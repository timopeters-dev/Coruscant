import { describe, expect, it } from "vitest";
import {
  AUTO_VALUATION_RESERVE,
  estimateMonthlyCalls,
  evaluateAutoValuationQuota,
  getNextDue,
  isAutoValuationDue,
  selectDueProperties,
  summarizePlannedConsumption,
} from "./auto-valuation-schedule";

describe("auto-valuation-schedule", () => {
  describe("getNextDue & isAutoValuationDue", () => {
    it("treats weekly as +7 days", () => {
      expect(getNextDue("weekly", "2026-11-11")).toEqual({ dueOn: "2026-11-18" });
      expect(
        isAutoValuationDue({
          interval: "weekly",
          lastDoneDateKey: "2026-11-11",
          lastAttemptDateKey: null,
          todayKey: "2026-11-17",
        }),
      ).toBe(false);
      expect(
        isAutoValuationDue({
          interval: "weekly",
          lastDoneDateKey: "2026-11-11",
          lastAttemptDateKey: null,
          todayKey: "2026-11-18",
        }),
      ).toBe(true);
    });

    it("treats biweekly as +14 days", () => {
      expect(getNextDue("biweekly", "2026-11-04")).toEqual({
        dueOn: "2026-11-18",
      });
      expect(
        isAutoValuationDue({
          interval: "biweekly",
          lastDoneDateKey: "2026-11-04",
          lastAttemptDateKey: null,
          todayKey: "2026-11-17",
        }),
      ).toBe(false);
      expect(
        isAutoValuationDue({
          interval: "biweekly",
          lastDoneDateKey: "2026-11-04",
          lastAttemptDateKey: null,
          todayKey: "2026-11-18",
        }),
      ).toBe(true);
    });

    it("clamps monthly end-of-month dates (2026-01-31 -> 2026-02-28)", () => {
      expect(getNextDue("monthly", "2026-01-31")).toEqual({
        dueOn: "2026-02-28",
      });
      expect(
        isAutoValuationDue({
          interval: "monthly",
          lastDoneDateKey: "2026-01-31",
          lastAttemptDateKey: null,
          todayKey: "2026-02-27",
        }),
      ).toBe(false);
      expect(
        isAutoValuationDue({
          interval: "monthly",
          lastDoneDateKey: "2026-01-31",
          lastAttemptDateKey: null,
          todayKey: "2026-02-28",
        }),
      ).toBe(true);
    });

    it("treats quarterly as +3 months", () => {
      expect(getNextDue("quarterly", "2026-01-31")).toEqual({
        dueOn: "2026-04-30",
      });
    });

    it("never marks off as due", () => {
      expect(getNextDue("off", null)).toBeNull();
      expect(
        isAutoValuationDue({
          interval: "off",
          lastDoneDateKey: null,
          lastAttemptDateKey: null,
          todayKey: "2026-11-18",
        }),
      ).toBe(false);
    });

    it("marks never-run property as immediately due", () => {
      expect(getNextDue("weekly", null)).toEqual({ dueNow: true });
      expect(
        isAutoValuationDue({
          interval: "weekly",
          lastDoneDateKey: null,
          lastAttemptDateKey: null,
          todayKey: "2026-11-18",
        }),
      ).toBe(true);
    });

    it("enforces at most one attempt per day even when overdue", () => {
      expect(
        isAutoValuationDue({
          interval: "weekly",
          lastDoneDateKey: "2026-11-01",
          lastAttemptDateKey: "2026-11-18",
          todayKey: "2026-11-18",
        }),
      ).toBe(false);

      expect(
        isAutoValuationDue({
          interval: "weekly",
          lastDoneDateKey: "2026-11-01",
          lastAttemptDateKey: "2026-11-17",
          todayKey: "2026-11-18",
        }),
      ).toBe(true);
    });

    it("is deterministic across restarts with identical DB inputs", () => {
      const input = {
        interval: "weekly" as const,
        lastDoneDateKey: "2026-11-10",
        lastAttemptDateKey: "2026-11-18",
        todayKey: "2026-11-18",
      };
      expect(isAutoValuationDue(input)).toBe(false);
      expect(isAutoValuationDue({ ...input })).toBe(false);
    });
  });

  describe("selectDueProperties", () => {
    it("sorts null first, then oldest lastDone, then lastAttempt, then id and caps at max", () => {
      const selected = selectDueProperties(
        [
          {
            id: "prop-d",
            interval: "weekly",
            lastDoneDateKey: "2026-11-05",
            lastAttemptDateKey: null,
          },
          {
            id: "prop-b",
            interval: "weekly",
            lastDoneDateKey: null,
            lastAttemptDateKey: "2026-11-17",
          },
          {
            id: "prop-a",
            interval: "weekly",
            lastDoneDateKey: null,
            lastAttemptDateKey: null,
          },
          {
            id: "prop-c",
            interval: "weekly",
            lastDoneDateKey: "2026-11-01",
            lastAttemptDateKey: null,
          },
          {
            id: "prop-off",
            interval: "off",
            lastDoneDateKey: null,
            lastAttemptDateKey: null,
          },
        ],
        "2026-11-18",
        3,
      );

      expect(selected.map((item) => item.id)).toEqual([
        "prop-a",
        "prop-b",
        "prop-c",
      ]);
    });
  });

  describe("evaluateAutoValuationQuota", () => {
    it("allows when snapshot is null", () => {
      expect(evaluateAutoValuationQuota(null, "2026-11-18T04:30:00Z")).toEqual({
        allowed: true,
        remaining: null,
        resetAt: null,
      });
    });

    it("protects reserve (remaining 4 allowed, 3 reserve_reached, 0 exhausted)", () => {
      expect(
        evaluateAutoValuationQuota(
          {
            limit: 10,
            used: 6,
            remaining: AUTO_VALUATION_RESERVE + 1,
            resetAt: "2026-12-01T00:00:00Z",
            tariff: "free",
          },
          "2026-11-18T04:30:00Z",
        ),
      ).toEqual({
        allowed: true,
        remaining: 4,
        resetAt: "2026-12-01T00:00:00Z",
      });

      expect(
        evaluateAutoValuationQuota(
          {
            limit: 10,
            used: 7,
            remaining: AUTO_VALUATION_RESERVE,
            resetAt: "2026-12-01T00:00:00Z",
            tariff: "free",
          },
          "2026-11-18T04:30:00Z",
        ),
      ).toEqual({
        allowed: false,
        reason: "reserve_reached",
        remaining: 3,
        resetAt: "2026-12-01T00:00:00Z",
      });

      expect(
        evaluateAutoValuationQuota(
          {
            limit: 10,
            used: 10,
            remaining: 0,
            resetAt: "2026-12-01T00:00:00Z",
            tariff: "free",
          },
          "2026-11-18T04:30:00Z",
        ),
      ).toEqual({
        allowed: false,
        reason: "exhausted",
        remaining: 0,
        resetAt: "2026-12-01T00:00:00Z",
      });
    });

    it("allows when now >= resetAt even if remaining is 0", () => {
      expect(
        evaluateAutoValuationQuota(
          {
            limit: 10,
            used: 10,
            remaining: 0,
            resetAt: "2026-12-01T00:00:00Z",
            tariff: "free",
          },
          "2026-12-01T00:00:00Z",
        ),
      ).toEqual({
        allowed: true,
        remaining: 0,
        resetAt: "2026-12-01T00:00:00Z",
      });
    });
  });

  describe("consumption summary", () => {
    it("estimates weekly as 4/month (52/12 half-up)", () => {
      expect(estimateMonthlyCalls("weekly")).toBe(4);
      expect(estimateMonthlyCalls("off")).toBe(0);
    });

    it("flags overBudget for two weekly properties (peak 10 > 7)", () => {
      expect(summarizePlannedConsumption(["weekly", "weekly"], 10, 3)).toEqual({
        averageMonthly: 9,
        peakMonthly: 10,
        autoBudget: 7,
        overBudget: true,
      });
    });

    it("stays within budget for monthly + quarterly (peak 2 <= 7)", () => {
      expect(summarizePlannedConsumption(["monthly", "quarterly"], 10, 3)).toEqual({
        averageMonthly: 1,
        peakMonthly: 2,
        autoBudget: 7,
        overBudget: false,
      });
    });

    it("returns zeros when all intervals are off", () => {
      expect(summarizePlannedConsumption(["off", "off"], 10, 3)).toEqual({
        averageMonthly: 0,
        peakMonthly: 0,
        autoBudget: 7,
        overBudget: false,
      });
    });
  });
});
