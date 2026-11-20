import {
  calculateRebalancingPlan,
  type RebalancingPlan,
} from "@/domain/recommendation/coach-rebalancing";
import type { InvestmentContext } from "@/domain/recommendation/investment-context";

/**
 * Rechnet den Rebalancing-Plan mit der aktuellen Sparrate neu (rein, ohne KI-Aufruf).
 * Depotwerte stammen aus dem Kontext, die Ziel-Gewichte aus der Bewertung.
 */
export function recomputeRebalancingPlan(
  context: InvestmentContext,
  targetWeightsBps: { etf: number; stock: number; crypto: number },
  monthlySavingsRateCents: number,
): RebalancingPlan {
  const valueOf = (assetClass: "etf" | "stock" | "crypto") =>
    context.portfolio.assetClasses.find((c) => c.assetClass === assetClass)
      ?.valueCents ?? 0;
  return calculateRebalancingPlan({
    currentValues: {
      etf: valueOf("etf"),
      stock: valueOf("stock"),
      crypto: valueOf("crypto"),
    },
    targetWeightsBps,
    monthlySavingsRateCents,
  });
}

/** Bei fehlgeschlagener Chat-Anfrage: Verlauf zurücksetzen und den Entwurf wiederherstellen. */
export function rollbackFailedChat<T>(
  previousMessages: readonly T[],
  failedText: string,
): { messages: T[]; draft: string } {
  return { messages: [...previousMessages], draft: failedText };
}
