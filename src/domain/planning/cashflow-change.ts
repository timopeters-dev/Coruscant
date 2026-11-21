/** Was ändert sich, wenn sich der monatliche Überschuss ändert? Vergleich der Topf-Füllstände. */
import { addMonthsToYearMonth, parseYearMonth } from "@/domain/core/date";
import { assertSafeInteger } from "@/domain/core/money";
import { calculateWaterfallSuggestion, type DomainPot } from "@/domain/allocation/waterfall";
import { simulateMonthlyWaterfall } from "@/domain/allocation/waterfall-simulation";
import { DEFAULT_CASHFLOW_HORIZON_MONTHS, MAX_SCENARIO_MONTHS } from "./etf";

// ---------------------------------------------------------------------------
// Gehaltssprung / Cashflow-Änderung
// ---------------------------------------------------------------------------

export interface CashflowChangeInput {
  startMonth: string;
  baseMonthlySurplusCents: number;
  change: { effectiveFromMonth: string; deltaMonthlyCents: number };
  pots: readonly DomainPot[];
  horizonMonths?: number;
}

export interface PotFillComparison {
  potId: string;
  potName: string;
  priority: number;
  targetCents: number | null;
  hasTarget: boolean;
  alreadyFilled: boolean;
  baselineMonthsToFill: number | null;
  baselineFillMonth: string | null;
  scenarioMonthsToFill: number | null;
  scenarioFillMonth: string | null;
  monthsGained: number | null;
}

export interface CashflowChangeResult {
  horizonMonths: number;
  scenarioSurplusAfterChangeCents: number;
  baselineDeficitMonths: number;
  scenarioDeficitMonths: number;
  pots: PotFillComparison[];
}

export function simulateCashflowChange(
  input: CashflowChangeInput,
): CashflowChangeResult {
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
  const horizon = assertSafeInteger(
    input.horizonMonths ?? DEFAULT_CASHFLOW_HORIZON_MONTHS,
    "horizonMonths",
  );
  if (horizon < 1 || horizon > MAX_SCENARIO_MONTHS) {
    throw new RangeError(
      `horizonMonths must be between 1 and ${MAX_SCENARIO_MONTHS}, received: ${horizon}`,
    );
  }

  // Validates pots (duplicates, rules, integer values) and fixes order.
  const sortedPlan = calculateWaterfallSuggestion(input.pots, 0, {
    mode: "monthly",
  });
  const potById = new Map(input.pots.map((pot) => [pot.id, pot]));
  const pots: DomainPot[] = sortedPlan.suggestions.map((s) => ({
    ...potById.get(s.potId)!,
  }));

  const effectiveFrom =
    input.change.effectiveFromMonth < input.startMonth
      ? input.startMonth
      : input.change.effectiveFromMonth;
  const monthOf = (t: number): string =>
    addMonthsToYearMonth(input.startMonth, t - 1);

  const baselineSurplus = (): number => base;
  const scenarioSurplus = (t: number): number =>
    monthOf(t) >= effectiveFrom ? base + delta : base;

  const targetIds = pots
    .filter((pot) => pot.targetCents !== null)
    .map((pot) => pot.id);
  const allFilled = (filled: ReadonlyMap<string, number>): boolean =>
    targetIds.every((id) => filled.has(id));

  // Run both with a shared stop condition evaluated after both are complete:
  // runs are independent; early stop per run is safe because filled months
  // never change once set.
  const baseline = simulateMonthlyWaterfall(pots, horizon, baselineSurplus, {
    stopWhen: ({ fillMonthIndex }) => allFilled(fillMonthIndex),
  });
  const scenario = simulateMonthlyWaterfall(pots, horizon, scenarioSurplus, {
    stopWhen: ({ fillMonthIndex }) => allFilled(fillMonthIndex),
  });

  const comparisons: PotFillComparison[] = pots.map((pot) => {
    const hasTarget = pot.targetCents !== null;
    const alreadyFilled =
      hasTarget && pot.currentCents >= (pot.targetCents as number);
    const b = hasTarget ? (baseline.fillMonthIndex.get(pot.id) ?? null) : null;
    const s = hasTarget ? (scenario.fillMonthIndex.get(pot.id) ?? null) : null;
    return {
      potId: pot.id,
      potName: pot.name,
      priority: pot.priority,
      targetCents: pot.targetCents,
      hasTarget,
      alreadyFilled,
      baselineMonthsToFill: b,
      baselineFillMonth:
        b === null ? null : addMonthsToYearMonth(input.startMonth, Math.max(0, b - 1)),
      scenarioMonthsToFill: s,
      scenarioFillMonth:
        s === null ? null : addMonthsToYearMonth(input.startMonth, Math.max(0, s - 1)),
      monthsGained: b !== null && s !== null ? b - s : null,
    };
  });

  return {
    horizonMonths: horizon,
    scenarioSurplusAfterChangeCents: base + delta,
    baselineDeficitMonths: baseline.deficitMonths,
    scenarioDeficitMonths: scenario.deficitMonths,
    pots: comparisons,
  };
}
