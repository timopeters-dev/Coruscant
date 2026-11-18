import { assertNonNegativeInteger, assertSafeInteger } from "./money";
import { calculateWaterfallSuggestion, type DomainPot } from "./waterfall";

export interface WaterfallSimulationResult {
  /** t (1-basiert, Monate ab Start), in dem targetCents erstmals erreicht wurde; 0 = schon zu Beginn erreicht. */
  fillMonthIndex: Map<string, number>;
  /** Stand je Topf nach Monat t; Index 0 = Startstand. Länge = simulierte Monate + 1. */
  balancesByPotId: Map<string, number[]>;
  deficitMonths: number;
  simulatedMonths: number;
}

export interface WaterfallSimulationOptions {
  stopWhen?: (state: {
    t: number;
    fillMonthIndex: ReadonlyMap<string, number>;
  }) => boolean;
}

/**
 * Simuliert die monatliche Wasserfall-Verteilung über `horizonMonths` Monate.
 * `surplusAt(month)` wird für t = 1..horizonMonths aufgerufen; negative Werte
 * zählen als Defizitmonat und speisen den Wasserfall mit 0 Cent.
 */
export function simulateMonthlyWaterfall(
  pots: readonly DomainPot[],
  horizonMonths: number,
  surplusAt: (month: number) => number,
  options?: WaterfallSimulationOptions,
): WaterfallSimulationResult {
  const horizon = assertNonNegativeInteger(horizonMonths, "horizonMonths");

  // Validate pots upfront even when horizon === 0.
  if (horizon === 0) {
    calculateWaterfallSuggestion(pots, 0, { mode: "monthly" });
  }

  const current = new Map<string, number>();
  const balancesByPotId = new Map<string, number[]>();
  const fillMonthIndex = new Map<string, number>();

  for (const pot of pots) {
    const start = assertNonNegativeInteger(pot.currentCents, "pot.currentCents");
    current.set(pot.id, start);
    balancesByPotId.set(pot.id, [start]);
    if (pot.targetCents !== null && start >= pot.targetCents) {
      fillMonthIndex.set(pot.id, 0);
    }
  }

  let deficitMonths = 0;
  let simulatedMonths = 0;

  for (let t = 1; t <= horizon; t += 1) {
    const surplus = assertSafeInteger(surplusAt(t), "surplusCents");
    if (surplus < 0) {
      deficitMonths += 1;
    }

    const working = pots.map((pot) => ({
      ...pot,
      currentCents: current.get(pot.id) ?? 0,
    }));
    const plan = calculateWaterfallSuggestion(working, Math.max(0, surplus), {
      mode: "monthly",
    });

    for (const s of plan.suggestions) {
      const next = assertSafeInteger(
        (current.get(s.potId) ?? 0) + s.allocatedCents,
        "potCurrentCents",
      );
      current.set(s.potId, next);
      balancesByPotId.get(s.potId)!.push(next);

      if (
        s.targetCents !== null &&
        next >= s.targetCents &&
        !fillMonthIndex.has(s.potId)
      ) {
        fillMonthIndex.set(s.potId, t);
      }
    }

    simulatedMonths = t;

    if (options?.stopWhen?.({ t, fillMonthIndex })) {
      for (let rest = t + 1; rest <= horizon; rest += 1) {
        if (assertSafeInteger(surplusAt(rest), "surplusCents") < 0) {
          deficitMonths += 1;
        }
      }
      break;
    }
  }

  return {
    fillMonthIndex,
    balancesByPotId,
    deficitMonths,
    simulatedMonths,
  };
}

/**
 * Liefert den simulierten Stand eines Topfs nach Monat `t`.
 * Bei einem Early-Stop (`t > simulatedMonths`) wird der letzte simulierte Stand
 * zurückgegeben. Das ist nur für Töpfe mit Ziel gültig, da diese im Wasserfall
 * beim Zielbetrag gedeckelt sind.
 */
export function balanceAt(
  result: WaterfallSimulationResult,
  potId: string,
  t: number,
): number {
  const month = assertNonNegativeInteger(t, "t");
  const series = result.balancesByPotId.get(potId);
  if (!series) {
    throw new RangeError(`Unknown potId: ${potId}`);
  }
  if (month >= series.length) {
    return series[series.length - 1]!;
  }
  return series[month]!;
}
