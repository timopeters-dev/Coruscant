import { addDaysToIsoDate, addMonthsToIsoDate, parseIsoDate } from "./date";
import { roundHalfUpBigInt } from "./money";

export const AUTO_VALUATION_INTERVALS = [
  "off",
  "weekly",
  "biweekly",
  "monthly",
  "quarterly",
] as const;

export type AutoValuationInterval = (typeof AUTO_VALUATION_INTERVALS)[number];

/** Richtwert: mindestens 3 Abfragen pro Monat für manuelle Läufe reservieren. */
export const AUTO_VALUATION_RESERVE = 3;

/** Richtwert: höchstens 3 Objekte pro Auto-Lauf abfragen. */
export const MAX_AUTO_VALUATIONS_PER_RUN = 3;

/** Richtwert: monatliches Free-Tier-Kontingent, solange kein API-Stand vorliegt. */
export const FREE_TIER_DEFAULT_LIMIT = 10;

export const YEARLY_CALLS: Record<AutoValuationInterval, number> = {
  off: 0,
  weekly: 52,
  biweekly: 26,
  monthly: 12,
  quarterly: 4,
};

export const PEAK_MONTHLY_CALLS: Record<AutoValuationInterval, number> = {
  off: 0,
  weekly: 5,
  biweekly: 3,
  monthly: 1,
  quarterly: 1,
};

export type NextDueResult = { dueNow: true } | { dueOn: string } | null;

export function getNextDue(
  interval: AutoValuationInterval,
  lastDoneDateKey: string | null,
): NextDueResult {
  if (interval === "off") {
    return null;
  }
  if (lastDoneDateKey === null) {
    return { dueNow: true };
  }
  parseIsoDate(lastDoneDateKey, "lastDoneDateKey");

  switch (interval) {
    case "weekly":
      return { dueOn: addDaysToIsoDate(lastDoneDateKey, 7) };
    case "biweekly":
      return { dueOn: addDaysToIsoDate(lastDoneDateKey, 14) };
    case "monthly":
      return { dueOn: addMonthsToIsoDate(lastDoneDateKey, 1) };
    case "quarterly":
      return { dueOn: addMonthsToIsoDate(lastDoneDateKey, 3) };
  }
}

export interface AutoValuationDueInput {
  interval: AutoValuationInterval;
  lastDoneDateKey: string | null;
  lastAttemptDateKey: string | null;
  todayKey: string;
}

export function isAutoValuationDue(input: AutoValuationDueInput): boolean {
  parseIsoDate(input.todayKey, "todayKey");
  if (input.interval === "off") {
    return false;
  }
  if (input.lastAttemptDateKey === input.todayKey) {
    return false;
  }
  const nextDue = getNextDue(input.interval, input.lastDoneDateKey);
  if (nextDue === null) {
    return false;
  }
  if ("dueNow" in nextDue) {
    return true;
  }
  return input.todayKey >= nextDue.dueOn;
}

export interface AutoValuationCandidate extends AutoValuationDueInput {
  id: string;
}

function compareNullableAsc(a: string | null, b: string | null): number {
  if (a === b) return 0;
  if (a === null) return -1;
  if (b === null) return 1;
  return a < b ? -1 : 1;
}

export function selectDueProperties<T extends Omit<AutoValuationCandidate, "todayKey">>(
  candidates: readonly T[],
  todayKey: string,
  max: number = MAX_AUTO_VALUATIONS_PER_RUN,
): T[] {
  if (max <= 0) {
    return [];
  }
  return candidates
    .filter((candidate) =>
      isAutoValuationDue({
        interval: candidate.interval,
        lastDoneDateKey: candidate.lastDoneDateKey,
        lastAttemptDateKey: candidate.lastAttemptDateKey,
        todayKey,
      }),
    )
    .sort((a, b) => {
      const doneCmp = compareNullableAsc(a.lastDoneDateKey, b.lastDoneDateKey);
      if (doneCmp !== 0) return doneCmp;
      const attemptCmp = compareNullableAsc(
        a.lastAttemptDateKey,
        b.lastAttemptDateKey,
      );
      if (attemptCmp !== 0) return attemptCmp;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    })
    .slice(0, max);
}

export interface QuotaSnapshot {
  limit: number;
  used: number;
  remaining: number;
  resetAt: string | null;
  tariff: string | null;
  observedAt?: string;
}

export interface QuotaEvaluation {
  allowed: boolean;
  reason?: "reserve_reached" | "exhausted";
  remaining: number | null;
  resetAt: string | null;
}

export function evaluateAutoValuationQuota(
  snapshot: QuotaSnapshot | null,
  nowIso: string,
  reserve: number = AUTO_VALUATION_RESERVE,
): QuotaEvaluation {
  if (snapshot === null) {
    return {
      allowed: true,
      remaining: null,
      resetAt: null,
    };
  }

  if (snapshot.resetAt != null && nowIso >= snapshot.resetAt) {
    return {
      allowed: true,
      remaining: snapshot.remaining,
      resetAt: snapshot.resetAt,
    };
  }

  if (snapshot.remaining <= 0) {
    return {
      allowed: false,
      reason: "exhausted",
      remaining: snapshot.remaining,
      resetAt: snapshot.resetAt,
    };
  }

  if (snapshot.remaining <= reserve) {
    return {
      allowed: false,
      reason: "reserve_reached",
      remaining: snapshot.remaining,
      resetAt: snapshot.resetAt,
    };
  }

  return {
    allowed: true,
    remaining: snapshot.remaining,
    resetAt: snapshot.resetAt,
  };
}

export function estimateMonthlyCalls(interval: AutoValuationInterval): number {
  const yearly = YEARLY_CALLS[interval];
  if (yearly === 0) return 0;
  return Number(roundHalfUpBigInt(BigInt(yearly), 12n));
}

export interface PlannedConsumptionSummary {
  averageMonthly: number;
  peakMonthly: number;
  autoBudget: number;
  overBudget: boolean;
}

export function summarizePlannedConsumption(
  intervals: readonly AutoValuationInterval[],
  limit: number = FREE_TIER_DEFAULT_LIMIT,
  reserve: number = AUTO_VALUATION_RESERVE,
): PlannedConsumptionSummary {
  let totalYearly = 0;
  let peakMonthly = 0;

  for (const interval of intervals) {
    totalYearly += YEARLY_CALLS[interval];
    peakMonthly += PEAK_MONTHLY_CALLS[interval];
  }

  const averageMonthly =
    totalYearly === 0 ? 0 : Number(roundHalfUpBigInt(BigInt(totalYearly), 12n));
  const autoBudget = Math.max(0, limit - reserve);

  return {
    averageMonthly,
    peakMonthly,
    autoBudget,
    overBudget: peakMonthly > autoBudget,
  };
}
