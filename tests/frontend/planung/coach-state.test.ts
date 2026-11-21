import { describe, expect, it } from "vitest";
import type { InvestmentContext } from "@/domain/recommendation/investment-context";
import { recomputeRebalancingPlan, rollbackFailedChat } from "@/frontend/planung/coach-state";

const ctx = {
  portfolio: {
    assetClasses: [
      { assetClass: "etf", valueCents: 600_000, weightBps: 6000 },
      { assetClass: "stock", valueCents: 300_000, weightBps: 3000 },
      { assetClass: "crypto", valueCents: 100_000, weightBps: 1000 },
    ],
  },
} as unknown as InvestmentContext;

const target = { etf: 5000, stock: 3000, crypto: 2000 };

describe("recomputeRebalancingPlan", () => {
  it("rechnet Monate und Split mit der geänderten Sparrate neu", () => {
    const slow = recomputeRebalancingPlan(ctx, target, 30_000);
    const fast = recomputeRebalancingPlan(ctx, target, 100_000);
    expect(slow.contributionOnly).toMatchObject({ status: "ok", monthsNeeded: 7 });
    expect(fast.contributionOnly).toMatchObject({ status: "ok", monthsNeeded: 2 });
    expect(Object.values(fast.contributionSplitCents).reduce((a, b) => a + b, 0)).toBe(100_000);
  });

  it("meldet no_savings_rate bei Sparrate 0", () => {
    expect(recomputeRebalancingPlan(ctx, target, 0).contributionOnly).toEqual({
      status: "unavailable",
      reason: "no_savings_rate",
    });
  });
});

describe("rollbackFailedChat", () => {
  it("stellt Verlauf und Entwurf wieder her, ohne das Original zu mutieren", () => {
    const history = [{ role: "user" as const, text: "Hallo" }];
    const result = rollbackFailedChat(history, "Zweite Frage");
    expect(result.messages).toEqual(history);
    expect(result.messages).not.toBe(history);
    expect(result.draft).toBe("Zweite Frage");
  });
});
