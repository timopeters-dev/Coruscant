import { parseIsoDate, parseYearMonth } from "@/lib/domain/date";
import {
  DEFAULT_RECOMMENDATION_ASSUMPTIONS,
  type RecommendationAssumptions,
} from "@/lib/domain/recommendation";
import {
  ALLOWED_CHURCH_TAX_BPS,
  DEFAULT_CASHFLOW_HORIZON_MONTHS,
  DEFAULT_SAVER_ALLOWANCE_CENTS,
  MAX_ETF_RETURN_BPS,
  MAX_SCENARIO_MONTHS,
  MAX_SAVER_ALLOWANCE_CENTS,
  MIN_ETF_RETURN_BPS,
  findBreakEvenReturnBps,
  simulateCashflowChange,
  simulatePrepaymentVsEtf,
  type BreakEvenResult,
  type CashflowChangeInput,
  type CashflowChangeResult,
  type PrepaymentDefaults,
  type PrepaymentVsEtfInput,
  type PrepaymentVsEtfResult,
} from "@/lib/domain/scenarios";
import type { DomainPot } from "@/lib/domain/waterfall";

export type PlanningEntry = "geld" | "gehalt" | "coach";
export type PlanningView = "empfehlung" | "sparrate" | "vergleich";

const ALLOWED_ENTRIES = new Set<PlanningEntry>(["geld", "gehalt", "coach"]);
const ALLOWED_VIEWS = new Set<PlanningView>([
  "empfehlung",
  "sparrate",
  "vergleich",
]);

export function parsePlanningEntry(
  raw: string | string[] | null | undefined,
): PlanningEntry | null {
  const first = Array.isArray(raw) ? raw[0] : raw;
  if (typeof first !== "string") return null;
  const trimmed = first.trim();
  if (ALLOWED_ENTRIES.has(trimmed as PlanningEntry)) {
    return trimmed as PlanningEntry;
  }
  return null;
}

export function parsePlanningView(
  raw: string | string[] | null | undefined,
): PlanningView {
  const first = Array.isArray(raw) ? raw[0] : raw;
  if (typeof first !== "string") return "empfehlung";
  const trimmed = first.trim();
  if (ALLOWED_VIEWS.has(trimmed as PlanningView)) {
    return trimmed as PlanningView;
  }
  return "empfehlung";
}

export function buildPlanningHref(
  entry: PlanningEntry | null,
  view?: PlanningView,
): string {
  if (!entry) return "/planung";
  if (entry === "geld" && view && view !== "empfehlung") {
    return `/planung?frage=geld&ansicht=${view}`;
  }
  return `/planung?frage=${entry}`;
}

export interface LoanOption {
  id: string;
  name: string;
  provider: string | null;
  defaults: PrepaymentDefaults;
}

export interface FreeMoneyState {
  loanId: string;
  oneTimeCents: number;
  monthlyCents: number;
  returnBps: number;
  allowanceCents: number;
  churchTaxBps: 0 | 800 | 900;
  usedThisYearCents: number;
  horizonOverride: { loanId: string; date: string } | null;
}

export const FREE_MONEY_DEFAULTS = {
  oneTimeCents: 1_000_000,
  monthlyCents: 20_000,
  returnBps: 600,
  allowanceCents: DEFAULT_SAVER_ALLOWANCE_CENTS,
  churchTaxBps: 0 as 0 | 800 | 900,
  usedThisYearCents: 0,
} as const;

export function defaultLoanId(
  loans: readonly LoanOption[],
  asOfDate: string,
): string {
  const withFuture = loans.find(
    (o) => o.defaults.horizonEndDate > asOfDate && !o.defaults.horizonEstimated,
  );
  return (withFuture ?? loans[0])?.id ?? "";
}

export function createFreeMoneyState(
  loans: readonly LoanOption[],
  asOfDate: string,
): FreeMoneyState {
  return {
    loanId: defaultLoanId(loans, asOfDate),
    oneTimeCents: FREE_MONEY_DEFAULTS.oneTimeCents,
    monthlyCents: FREE_MONEY_DEFAULTS.monthlyCents,
    returnBps: FREE_MONEY_DEFAULTS.returnBps,
    allowanceCents: FREE_MONEY_DEFAULTS.allowanceCents,
    churchTaxBps: FREE_MONEY_DEFAULTS.churchTaxBps,
    usedThisYearCents: FREE_MONEY_DEFAULTS.usedThisYearCents,
    horizonOverride: null,
  };
}

export type FreeMoneyAction =
  | { type: "setLoan"; loanId: string }
  | {
      type: "setField";
      field:
        | "oneTimeCents"
        | "monthlyCents"
        | "usedThisYearCents"
        | "allowanceCents"
        | "returnBps";
      value: number;
    }
  | { type: "setChurchTax"; bps: number }
  | { type: "setHorizon"; date: string }
  | { type: "reset"; loans: readonly LoanOption[]; asOfDate: string };

export function freeMoneyReducer(
  s: FreeMoneyState,
  a: FreeMoneyAction,
  loans?: readonly LoanOption[],
): FreeMoneyState {
  switch (a.type) {
    case "setLoan": {
      if (!a.loanId) return s;
      if (loans && !loans.some((l) => l.id === a.loanId)) return s;
      if (s.loanId === a.loanId) return s;
      return { ...s, loanId: a.loanId };
    }
    case "setField": {
      if (!Number.isSafeInteger(a.value)) return s;
      let nextValue = a.value;
      if (
        a.field === "oneTimeCents" ||
        a.field === "monthlyCents" ||
        a.field === "usedThisYearCents"
      ) {
        nextValue = Math.max(0, nextValue);
      } else if (a.field === "allowanceCents") {
        nextValue = Math.min(MAX_SAVER_ALLOWANCE_CENTS, Math.max(0, nextValue));
      }
      if (s[a.field] === nextValue) return s;
      return { ...s, [a.field]: nextValue };
    }
    case "setChurchTax": {
      if (
        !(ALLOWED_CHURCH_TAX_BPS as readonly number[]).includes(a.bps)
      ) {
        return s;
      }
      const next = a.bps as 0 | 800 | 900;
      if (s.churchTaxBps === next) return s;
      return { ...s, churchTaxBps: next };
    }
    case "setHorizon": {
      if (!a.date) return s;
      try {
        parseIsoDate(a.date, "horizonEndDate");
      } catch {
        return s;
      }
      return {
        ...s,
        horizonOverride: { loanId: s.loanId, date: a.date },
      };
    }
    case "reset": {
      return createFreeMoneyState(a.loans, a.asOfDate);
    }
  }
}

export type FreeMoneyView =
  | { kind: "no_loans" }
  | { kind: "zero_budget"; loan: LoanOption }
  | { kind: "invalid"; message: string }
  | { kind: "horizon_elapsed"; loan: LoanOption; result: PrepaymentVsEtfResult }
  | {
      kind: "ok";
      loan: LoanOption;
      horizonEndDate: string;
      input: PrepaymentVsEtfInput;
      result: PrepaymentVsEtfResult;
    };

export function deriveFreeMoneyView(
  s: FreeMoneyState,
  loans: readonly LoanOption[],
  asOfDate: string,
): FreeMoneyView {
  if (loans.length === 0) {
    return { kind: "no_loans" };
  }
  const loan = loans.find((l) => l.id === s.loanId) ?? loans[0]!;

  if (s.oneTimeCents === 0 && s.monthlyCents === 0) {
    return { kind: "zero_budget", loan };
  }

  const horizonEndDate =
    s.horizonOverride && s.horizonOverride.loanId === loan.id
      ? s.horizonOverride.date
      : loan.defaults.horizonEndDate || asOfDate;

  const input: PrepaymentVsEtfInput = {
    loan: loan.defaults.loan,
    startDate: loan.defaults.startDate,
    horizonEndDate,
    oneTimeAmountCents: s.oneTimeCents,
    monthlyAmountCents: s.monthlyCents,
    specialRepaymentUsedThisYearCents: s.usedThisYearCents,
    saverAllowanceCents: s.allowanceCents,
    churchTaxBps: s.churchTaxBps,
    etfAnnualReturnBps: s.returnBps,
  };

  try {
    const result = simulatePrepaymentVsEtf(input);
    if (result.flags.horizonElapsed) {
      return { kind: "horizon_elapsed", loan, result };
    }
    return { kind: "ok", loan, horizonEndDate, input, result };
  } catch (error) {
    return {
      kind: "invalid",
      message:
        error instanceof RangeError
          ? error.message
          : "Berechnung nicht möglich.",
    };
  }
}

export function safeBreakEven(view: FreeMoneyView): BreakEvenResult | null {
  if (view.kind !== "ok") return null;
  try {
    const { etfAnnualReturnBps: _ignored, ...baseInput } = view.input;
    void _ignored;
    return findBreakEvenReturnBps(baseInput);
  } catch {
    return null;
  }
}

export function isFreeMoneyAdvancedModified(s: FreeMoneyState): boolean {
  return (
    s.allowanceCents !== FREE_MONEY_DEFAULTS.allowanceCents ||
    s.churchTaxBps !== FREE_MONEY_DEFAULTS.churchTaxBps ||
    s.usedThisYearCents !== FREE_MONEY_DEFAULTS.usedThisYearCents ||
    s.horizonOverride !== null
  );
}

// ---------------------------------------------------------------------------
// Mehr Gehalt (Salary)
// ---------------------------------------------------------------------------

export const DEFAULT_SALARY_HORIZON_YEARS = DEFAULT_CASHFLOW_HORIZON_MONTHS / 12;
export const MAX_SALARY_HORIZON_YEARS = MAX_SCENARIO_MONTHS / 12;

export interface SalaryState {
  deltaCents: number;
  fromMonth: string;
  horizonYears: number;
}

export function createSalaryState(startMonth: string): SalaryState {
  return {
    deltaCents: 50_000,
    fromMonth: startMonth,
    horizonYears: DEFAULT_SALARY_HORIZON_YEARS,
  };
}

export type SalaryAction =
  | { type: "setDelta"; value: number }
  | { type: "setFromMonth"; value: string; startMonth: string }
  | { type: "setHorizonYears"; value: number }
  | { type: "reset"; startMonth: string };

export function salaryReducer(s: SalaryState, a: SalaryAction): SalaryState {
  switch (a.type) {
    case "setDelta": {
      if (!Number.isSafeInteger(a.value)) return s;
      if (s.deltaCents === a.value) return s;
      return { ...s, deltaCents: a.value };
    }
    case "setFromMonth": {
      try {
        parseYearMonth(a.value, "fromMonth");
      } catch {
        return s;
      }
      const clamped = a.value < a.startMonth ? a.startMonth : a.value;
      if (s.fromMonth === clamped) return s;
      return { ...s, fromMonth: clamped };
    }
    case "setHorizonYears": {
      if (!Number.isSafeInteger(a.value)) return s;
      const clamped = Math.min(MAX_SALARY_HORIZON_YEARS, Math.max(1, a.value));
      if (s.horizonYears === clamped) return s;
      return { ...s, horizonYears: clamped };
    }
    case "reset": {
      return createSalaryState(a.startMonth);
    }
  }
}

export type SalaryView =
  | { kind: "no_pots" }
  | { kind: "invalid"; message: string }
  | {
      kind: "ok";
      input: CashflowChangeInput;
      result: CashflowChangeResult;
      targetPotCount: number;
      hiddenPotCount: number;
      baseSurplusNonPositive: boolean;
    };

export function deriveSalaryView(
  s: SalaryState,
  ctx: {
    baseSurplusCents: number;
    pots: readonly DomainPot[];
    startMonth: string;
  },
): SalaryView {
  if (ctx.pots.length === 0) {
    return { kind: "no_pots" };
  }

  const input: CashflowChangeInput = {
    startMonth: ctx.startMonth,
    baseMonthlySurplusCents: ctx.baseSurplusCents,
    change: {
      effectiveFromMonth: s.fromMonth,
      deltaMonthlyCents: s.deltaCents,
    },
    pots: ctx.pots,
    horizonMonths: s.horizonYears * 12,
  };

  try {
    const result = simulateCashflowChange(input);
    const targetPotCount = result.pots.filter((p) => p.hasTarget).length;
    const hiddenPotCount = result.pots.length - targetPotCount;
    return {
      kind: "ok",
      input,
      result,
      targetPotCount,
      hiddenPotCount,
      baseSurplusNonPositive: ctx.baseSurplusCents <= 0,
    };
  } catch (error) {
    return {
      kind: "invalid",
      message:
        error instanceof RangeError
          ? error.message
          : "Berechnung nicht möglich.",
    };
  }
}

export function isSalaryAdvancedModified(s: SalaryState): boolean {
  return s.horizonYears !== DEFAULT_SALARY_HORIZON_YEARS;
}

// ---------------------------------------------------------------------------
// Empfehlung ("Wohin mit X €?" + "Sparrate empfehlen")
// ---------------------------------------------------------------------------

export interface RecommendationUiState {
  amountCents: number;
  assumptions: RecommendationAssumptions;
}

export const RECOMMENDATION_DEFAULT_AMOUNT_CENTS = 1_000_000;
export const RECOMMENDATION_MAX_AMOUNT_CENTS = 1_000_000_000;

export function createRecommendationUiState(): RecommendationUiState {
  return {
    amountCents: RECOMMENDATION_DEFAULT_AMOUNT_CENTS,
    assumptions: {
      ...DEFAULT_RECOMMENDATION_ASSUMPTIONS,
      specialRepaymentUsedThisYearCentsByLoanId: {},
    },
  };
}

export type RecommendationUiAction =
  | { type: "setAmount"; value: number }
  | {
      type: "setAssumption";
      field: Exclude<
        keyof RecommendationAssumptions,
        "specialRepaymentUsedThisYearCentsByLoanId"
      >;
      value: number;
    }
  | { type: "setLoanUsedThisYear"; loanId: string; value: number }
  | { type: "reset" };

export function recommendationReducer(
  s: RecommendationUiState,
  a: RecommendationUiAction,
): RecommendationUiState {
  switch (a.type) {
    case "setAmount": {
      if (!Number.isSafeInteger(a.value)) return s;
      const clamped = Math.min(
        RECOMMENDATION_MAX_AMOUNT_CENTS,
        Math.max(0, a.value),
      );
      if (s.amountCents === clamped) return s;
      return { ...s, amountCents: clamped };
    }
    case "setAssumption": {
      if (!Number.isSafeInteger(a.value)) return s;
      const v = a.value;
      switch (a.field) {
        case "emergencyFundMonths":
          if (v < 1 || v > 12) return s;
          break;
        case "etfAnnualReturnBps":
          if (v < MIN_ETF_RETURN_BPS || v > MAX_ETF_RETURN_BPS) return s;
          break;
        case "safetyMarginBps":
          if (v < 0 || v > 500) return s;
          break;
        case "saverAllowanceCents":
          if (v < 0 || v > MAX_SAVER_ALLOWANCE_CENTS) return s;
          break;
        case "churchTaxBps":
          if (!(ALLOWED_CHURCH_TAX_BPS as readonly number[]).includes(v)) {
            return s;
          }
          break;
        case "shortHorizonMonths":
          if (v < 1 || v > 120) return s;
          break;
        case "savingsBufferBps":
          if (v < 0 || v > 5000) return s;
          break;
        case "emergencyFillMonths":
          if (v < 1 || v > 60) return s;
          break;
      }
      if (s.assumptions[a.field] === v) return s;
      return {
        ...s,
        assumptions: {
          ...s.assumptions,
          [a.field]: v,
        },
      };
    }
    case "setLoanUsedThisYear": {
      if (!a.loanId || !Number.isSafeInteger(a.value) || a.value < 0) {
        return s;
      }
      const prev =
        s.assumptions.specialRepaymentUsedThisYearCentsByLoanId[a.loanId] ?? 0;
      if (prev === a.value) return s;
      return {
        ...s,
        assumptions: {
          ...s.assumptions,
          specialRepaymentUsedThisYearCentsByLoanId: {
            ...s.assumptions.specialRepaymentUsedThisYearCentsByLoanId,
            [a.loanId]: a.value,
          },
        },
      };
    }
    case "reset": {
      return createRecommendationUiState();
    }
  }
}

export function isRecommendationAssumptionsModified(
  s: RecommendationUiState,
): boolean {
  const a = s.assumptions;
  const d = DEFAULT_RECOMMENDATION_ASSUMPTIONS;
  return (
    a.emergencyFundMonths !== d.emergencyFundMonths ||
    a.etfAnnualReturnBps !== d.etfAnnualReturnBps ||
    a.safetyMarginBps !== d.safetyMarginBps ||
    a.saverAllowanceCents !== d.saverAllowanceCents ||
    a.churchTaxBps !== d.churchTaxBps ||
    a.shortHorizonMonths !== d.shortHorizonMonths ||
    a.savingsBufferBps !== d.savingsBufferBps ||
    a.emergencyFillMonths !== d.emergencyFillMonths ||
    Object.values(a.specialRepaymentUsedThisYearCentsByLoanId).some(
      (v) => v > 0,
    )
  );
}
