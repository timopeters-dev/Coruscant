import { addMonthsToYearMonth, parseIsoDate, toYearMonth } from "@/domain/core/date";
import { assertNonNegativeInteger, assertSafeInteger } from "@/domain/core/money";
import { calculateWaterfallSuggestion, type DomainPot } from "./waterfall";
import { balanceAt, simulateMonthlyWaterfall } from "./waterfall-simulation";

export const DEADLINE_ON_TRACK_BUFFER_MONTHS = 3;
export const MAX_POT_DEADLINE_MONTHS = 480;

export type PotDeadlineStatus =
  | "reached"
  | "overdue"
  | "on_track"
  | "tight"
  | "at_risk";

export interface DeadlinePotInput extends DomainPot {
  targetDate?: string | null;
}

export interface PotDeadlineEvaluation {
  potId: string;
  potName: string;
  targetDate: string;
  targetMonth: string;
  targetCents: number;
  currentCents: number;
  status: PotDeadlineStatus;
  restMonths: number;
  shortfallNowCents: number;
  requiredMonthlyCents: number;
  requiredIsOneTime: boolean;
  plannedMonthlyCents: number | null;
  projectedAtDeadlineCents: number;
  shortfallAtDeadlineCents: number;
  expectedReachMonth: string | null;
  monthsBuffer: number | null;
}

/**
 * Zählt die verbleibenden vollen Monate nach dem aktuellen Monat bis einschließlich
 * des Zielmonats (`targetIsoDate`). Liegt das Ziel im laufenden Monat oder davor, ist
 * das Ergebnis 0.
 */
export function countRemainingMonths(
  todayIsoDate: string,
  targetIsoDate: string,
): number {
  const today = parseIsoDate(todayIsoDate, "todayIsoDate");
  const target = parseIsoDate(targetIsoDate, "targetIsoDate");
  const diff = (target.year - today.year) * 12 + (target.month - today.month);
  return Math.max(0, diff);
}

/**
 * Berechnet die erforderliche Monatsrate ⌈shortfallCents / restMonths⌉ per BigInt.
 * Bei `restMonths === 0` wird der Fehlbetrag als Einmalbetrag zurückgegeben.
 */
export function calculateRequiredMonthlyCents(
  shortfallCents: number,
  restMonths: number,
): number {
  const shortfall = assertNonNegativeInteger(shortfallCents, "shortfallCents");
  const months = assertNonNegativeInteger(restMonths, "restMonths");
  if (shortfall === 0) {
    return 0;
  }
  if (months === 0) {
    return shortfall;
  }
  const ceil = (BigInt(shortfall) + BigInt(months) - 1n) / BigInt(months);
  return assertSafeInteger(Number(ceil), "requiredMonthlyCents");
}

/**
 * Bewertet alle Töpfe mit gesetztem `targetDate` anhand einer gemeinsamen
 * Monat-für-Monat-Wasserfall-Simulation über alle Töpfe.
 */
export function evaluatePotDeadlines(input: {
  pots: readonly DeadlinePotInput[];
  monthlySurplusCents: number;
  todayIsoDate: string;
}): PotDeadlineEvaluation[] {
  parseIsoDate(input.todayIsoDate, "todayIsoDate");
  const currentYM = toYearMonth(input.todayIsoDate);
  const surplus = assertSafeInteger(
    input.monthlySurplusCents,
    "monthlySurplusCents",
  );
  const effectiveSurplus = Math.max(0, surplus);

  // Validates pots (duplicates, integer values, rule invariants) and fixes priority order.
  const sortedPlan = calculateWaterfallSuggestion(input.pots, 0, {
    mode: "monthly",
  });
  const potById = new Map(input.pots.map((pot) => [pot.id, pot]));
  const orderedPots = sortedPlan.suggestions.map(
    (s) => potById.get(s.potId)!,
  );

  const deadlinePots: DeadlinePotInput[] = [];
  for (const pot of orderedPots) {
    if (pot.targetDate == null) {
      continue;
    }
    parseIsoDate(pot.targetDate, "targetDate");
    if (pot.targetCents === null) {
      throw new RangeError(
        `Pot "${pot.id}" has targetDate without targetCents`,
      );
    }
    deadlinePots.push(pot);
  }

  if (deadlinePots.length === 0) {
    return [];
  }

  const maxRestMonths = Math.max(
    0,
    ...deadlinePots.map((pot) =>
      countRemainingMonths(input.todayIsoDate, pot.targetDate!),
    ),
  );

  const sim = simulateMonthlyWaterfall(
    orderedPots,
    MAX_POT_DEADLINE_MONTHS,
    () => effectiveSurplus,
    {
      stopWhen: ({ t, fillMonthIndex }) =>
        t >= maxRestMonths &&
        deadlinePots.every((pot) => fillMonthIndex.has(pot.id)),
    },
  );

  return deadlinePots.map((pot) => {
    const targetDate = pot.targetDate!;
    const targetMonth = toYearMonth(targetDate);
    const targetCents = pot.targetCents!;
    const currentCents = pot.currentCents;
    const shortfallNowCents = Math.max(0, targetCents - currentCents);
    const isOverdue = targetDate < input.todayIsoDate;
    const restMonths = countRemainingMonths(input.todayIsoDate, targetDate);

    const fillMonth = sim.fillMonthIndex.get(pot.id) ?? null;
    const expectedReachMonth =
      fillMonth === null
        ? null
        : addMonthsToYearMonth(currentYM, fillMonth);

    const rawProjected = balanceAt(sim, pot.id, restMonths);
    const projectedAtDeadlineCents = Math.min(targetCents, rawProjected);
    const shortfallAtDeadlineCents = Math.max(
      0,
      targetCents - projectedAtDeadlineCents,
    );

    const requiredMonthlyCents = calculateRequiredMonthlyCents(
      shortfallNowCents,
      restMonths,
    );
    const requiredIsOneTime = shortfallNowCents > 0 && restMonths === 0;
    const plannedMonthlyCents =
      restMonths === 0
        ? null
        : assertSafeInteger(
            Number(
              BigInt(Math.max(0, rawProjected - currentCents)) /
                BigInt(restMonths),
            ),
            "plannedMonthlyCents",
          );

    let status: PotDeadlineStatus;
    let monthsBuffer: number | null = null;

    if (currentCents >= targetCents) {
      status = "reached";
    } else if (isOverdue) {
      status = "overdue";
    } else if (fillMonth !== null && fillMonth <= restMonths) {
      monthsBuffer = restMonths - fillMonth;
      status =
        monthsBuffer >= DEADLINE_ON_TRACK_BUFFER_MONTHS ? "on_track" : "tight";
    } else {
      status = "at_risk";
    }

    return {
      potId: pot.id,
      potName: pot.name,
      targetDate,
      targetMonth,
      targetCents,
      currentCents,
      status,
      restMonths,
      shortfallNowCents,
      requiredMonthlyCents,
      requiredIsOneTime,
      plannedMonthlyCents,
      projectedAtDeadlineCents,
      shortfallAtDeadlineCents,
      expectedReachMonth,
      monthsBuffer,
    };
  });
}

export function summarizeDeadlineRisks(
  evals: readonly PotDeadlineEvaluation[],
): {
  atRiskCount: number;
  overdueCount: number;
  tightCount: number;
  worst: PotDeadlineEvaluation | null;
} {
  let atRiskCount = 0;
  let overdueCount = 0;
  let tightCount = 0;
  const critical: PotDeadlineEvaluation[] = [];

  for (const item of evals) {
    if (item.status === "at_risk") {
      atRiskCount += 1;
      critical.push(item);
    } else if (item.status === "overdue") {
      overdueCount += 1;
      critical.push(item);
    } else if (item.status === "tight") {
      tightCount += 1;
    }
  }

  critical.sort((a, b) => {
    const rankA = a.status === "at_risk" ? 0 : 1;
    const rankB = b.status === "at_risk" ? 0 : 1;
    if (rankA !== rankB) {
      return rankA - rankB;
    }
    const dateCmp = a.targetDate.localeCompare(b.targetDate);
    if (dateCmp !== 0) {
      return dateCmp;
    }
    return a.potId.localeCompare(b.potId);
  });

  return {
    atRiskCount,
    overdueCount,
    tightCount,
    worst: critical[0] ?? null,
  };
}
