import { addMonthsToYearMonth, parseYearMonth } from "@/domain/core/date";
import { assertSafeInteger } from "@/domain/core/money";
import { MAX_SCENARIO_MONTHS } from "@/domain/planning/etf";
import { calculateWaterfallSuggestion, type DomainPot } from "./waterfall";
import {
  simulateMonthlyWaterfall,
  type WaterfallSimulationResult,
} from "./waterfall-simulation";

export interface CashflowChangeSeriesInput {
  startMonth: string;
  baseMonthlySurplusCents: number;
  change: { effectiveFromMonth: string; deltaMonthlyCents: number };
  pots: readonly DomainPot[];
  horizonMonths: number;
}

export interface CashflowSeriesRun {
  /** Index t = Stand nach Monat t; t = 0 = Startstand. Länge = horizonMonths + 1. */
  totalCents: number[];
  byPotId: Record<string, number[]>;
  deficitMonths: number;
}

export interface CashflowChangeSeries {
  horizonMonths: number;
  /** Länge H + 1. months[0] = startMonth („heute/Start“), months[t] = addMonthsToYearMonth(startMonth, t - 1) für t ≥ 1. */
  months: string[];
  baseline: CashflowSeriesRun;
  scenario: CashflowSeriesRun;
}

function toSeriesRun(
  sim: WaterfallSimulationResult,
  pots: readonly DomainPot[],
  horizon: number,
): CashflowSeriesRun {
  const byPotId: Record<string, number[]> = {};
  for (const pot of pots) {
    byPotId[pot.id] = [...(sim.balancesByPotId.get(pot.id) ?? [])];
  }

  const totalCents: number[] = [];
  for (let t = 0; t <= horizon; t += 1) {
    let sum = 0;
    for (const pot of pots) {
      sum = assertSafeInteger(sum + (byPotId[pot.id]?.[t] ?? 0), "totalCents");
    }
    totalCents.push(sum);
  }

  return {
    totalCents,
    byPotId,
    deficitMonths: sim.deficitMonths,
  };
}

/**
 * Simulates the monthly pot balances (baseline vs. cashflow change) over a
 * fixed horizon without early stopping.
 */
export function simulateCashflowChangeSeries(
  input: CashflowChangeSeriesInput,
): CashflowChangeSeries {
  parseYearMonth(input.startMonth, "startMonth");
  parseYearMonth(input.change.effectiveFromMonth, "effectiveFromMonth");
  const base = assertSafeInteger(
    input.baseMonthlySurplusCents,
    "baseMonthlySurplusCents",
  );
  const delta = assertSafeInteger(
    input.change.deltaMonthlyCents,
    "deltaMonthlyCents",
  );
  const horizon = assertSafeInteger(input.horizonMonths, "horizonMonths");
  if (horizon < 1 || horizon > MAX_SCENARIO_MONTHS) {
    throw new RangeError(
      `horizonMonths must be between 1 and ${MAX_SCENARIO_MONTHS}, received: ${horizon}`,
    );
  }

  const sortedPlan = calculateWaterfallSuggestion(input.pots, 0, {
    mode: "monthly",
  });
  const potById = new Map(input.pots.map((pot) => [pot.id, pot]));
  const orderedPots: DomainPot[] = sortedPlan.suggestions.map((s) => ({
    ...potById.get(s.potId)!,
  }));

  const effectiveFrom =
    input.change.effectiveFromMonth < input.startMonth
      ? input.startMonth
      : input.change.effectiveFromMonth;

  const monthOf = (t: number): string =>
    addMonthsToYearMonth(input.startMonth, t - 1);

  const baselineSim = simulateMonthlyWaterfall(
    orderedPots,
    horizon,
    () => base,
  );
  const scenarioSim = simulateMonthlyWaterfall(orderedPots, horizon, (t) =>
    monthOf(t) >= effectiveFrom ? base + delta : base,
  );

  const months: string[] = [input.startMonth];
  for (let t = 1; t <= horizon; t += 1) {
    months.push(monthOf(t));
  }

  return {
    horizonMonths: horizon,
    months,
    baseline: toSeriesRun(baselineSim, orderedPots, horizon),
    scenario: toSeriesRun(scenarioSim, orderedPots, horizon),
  };
}
