import {
  applyCappedSpecialRepayment,
  calculateMonthlyInterestCents,
  projectContractBalance,
  stepContractMonth,
  type DomainContract,
  type RepaymentType,
} from "./contracts";
import {
  addMonthsToIsoDate,
  addMonthsToYearMonth,
  countCompletedMonths,
  parseIsoDate,
  parseYearMonth,
} from "./date";
import {
  type RateCorridor,
  remainingSpecialRepaymentCents,
  resolveRateCorridor,
  resolveYearlyCapCents,
  type SpecialRepaymentAllowance,
  type SpecialRepaymentRule,
  specialRepaymentRule,
} from "./loan-options";
import {
  assertNonNegativeInteger,
  assertSafeInteger,
  roundHalfUpBigInt,
} from "./money";
import { calculateWaterfallSuggestion, type DomainPot } from "./waterfall";
import { simulateMonthlyWaterfall } from "./waterfall-simulation";

export const MAX_SCENARIO_MONTHS = 480;
export const DEFAULT_CASHFLOW_HORIZON_MONTHS = 360;
export const MIN_ETF_RETURN_BPS = -5000;
export const MAX_ETF_RETURN_BPS = 3000;
export const SOLI_BPS = 550;
export const PARTIAL_EXEMPTION_EQUITY_ETF_BPS = 3000;
export const DEFAULT_SAVER_ALLOWANCE_CENTS = 100_000;
export const MAX_SAVER_ALLOWANCE_CENTS = 200_000;
export const ALLOWED_CHURCH_TAX_BPS = [0, 800, 900] as const;
export const DEFAULT_ESTIMATED_HORIZON_MONTHS = 120;

const GROWTH_SCALE = 10n ** 12n;
const BPS_DENOMINATOR = 10_000;

// ---------------------------------------------------------------------------
// Bausteine: Wachstum
// ---------------------------------------------------------------------------

/**
 * Monthly growth factor (scaled by 10^12) equivalent to an effective annual
 * return: floor(12th root of (1 + bps/10000) * S). Pure BigInt binary search.
 */
export function computeMonthlyGrowthFactor(annualReturnBps: number): bigint {
  const bps = assertSafeInteger(annualReturnBps, "annualReturnBps");
  if (bps < MIN_ETF_RETURN_BPS || bps > MAX_ETF_RETURN_BPS) {
    throw new RangeError(
      `annualReturnBps must be between ${MIN_ETF_RETURN_BPS} and ${MAX_ETF_RETURN_BPS}, received: ${bps}`,
    );
  }

  const ratioNumerator = BigInt(BPS_DENOMINATOR + bps);
  const target = ratioNumerator * GROWTH_SCALE ** 12n;
  const denominator = BigInt(BPS_DENOMINATOR);

  let low = GROWTH_SCALE / 2n;
  let high = GROWTH_SCALE * 2n;
  while (low < high) {
    const mid = (low + high + 1n) / 2n;
    if (mid ** 12n * denominator <= target) {
      low = mid;
    } else {
      high = mid - 1n;
    }
  }
  return low;
}

/**
 * Applies a monthly growth factor to a non-negative cent value (BigInt half-up).
 */
export function applyMonthlyGrowth(valueCents: number, factor: bigint): number {
  const safeValue = assertNonNegativeInteger(valueCents, "valueCents");
  if (factor <= 0n) {
    throw new RangeError("factor must be positive");
  }
  const grown = roundHalfUpBigInt(BigInt(safeValue) * factor, GROWTH_SCALE);
  return assertSafeInteger(Number(grown), "grownValueCents");
}

// ---------------------------------------------------------------------------
// Bausteine: Steuer
// ---------------------------------------------------------------------------

export interface EtfTaxBreakdown {
  gainCents: number;
  taxablePartCents: number;
  allowanceUsedCents: number;
  taxableCents: number;
  capitalGainsTaxCents: number;
  soliCents: number;
  churchTaxCents: number;
  totalTaxCents: number;
  netValueCents: number;
}

export interface EtfLiquidationTaxInput {
  valueCents: number;
  costBasisCents: number;
  saverAllowanceCents: number;
  churchTaxBps: number;
  partialExemptionBps?: number;
}

function mulDivHalfUp(a: number, b: number, c: number): number {
  return Number(roundHalfUpBigInt(BigInt(a) * BigInt(b), BigInt(c)));
}

/**
 * Taxes a fictitious full liquidation (German KapESt incl. Soli and optional
 * KiSt reduction per § 32d EStG). No loss offsetting: losses yield zero tax.
 */
export function calculateEtfLiquidationTax(
  input: EtfLiquidationTaxInput,
): EtfTaxBreakdown {
  const value = assertNonNegativeInteger(input.valueCents, "valueCents");
  const basis = assertNonNegativeInteger(input.costBasisCents, "costBasisCents");
  const allowance = assertNonNegativeInteger(
    input.saverAllowanceCents,
    "saverAllowanceCents",
  );
  if (allowance > MAX_SAVER_ALLOWANCE_CENTS) {
    throw new RangeError(
      `saverAllowanceCents must be <= ${MAX_SAVER_ALLOWANCE_CENTS}, received: ${allowance}`,
    );
  }
  const kistBps = assertSafeInteger(input.churchTaxBps, "churchTaxBps");
  if (!(ALLOWED_CHURCH_TAX_BPS as readonly number[]).includes(kistBps)) {
    throw new RangeError(
      `churchTaxBps must be one of ${ALLOWED_CHURCH_TAX_BPS.join(", ")}, received: ${kistBps}`,
    );
  }
  const exemptionBps = assertNonNegativeInteger(
    input.partialExemptionBps ?? PARTIAL_EXEMPTION_EQUITY_ETF_BPS,
    "partialExemptionBps",
  );
  if (exemptionBps > BPS_DENOMINATOR) {
    throw new RangeError(
      `partialExemptionBps must be <= ${BPS_DENOMINATOR}, received: ${exemptionBps}`,
    );
  }

  const gainCents = Math.max(0, value - basis);
  const taxablePartCents = mulDivHalfUp(
    gainCents,
    BPS_DENOMINATOR - exemptionBps,
    BPS_DENOMINATOR,
  );
  const allowanceUsedCents = Math.min(allowance, taxablePartCents);
  const taxableCents = taxablePartCents - allowanceUsedCents;

  const capitalGainsTaxCents = mulDivHalfUp(
    taxableCents,
    BPS_DENOMINATOR,
    4 * BPS_DENOMINATOR + kistBps,
  );
  const soliCents = mulDivHalfUp(
    capitalGainsTaxCents,
    SOLI_BPS,
    BPS_DENOMINATOR,
  );
  const churchTaxCents = mulDivHalfUp(
    capitalGainsTaxCents,
    kistBps,
    BPS_DENOMINATOR,
  );
  const totalTaxCents = capitalGainsTaxCents + soliCents + churchTaxCents;

  return {
    gainCents,
    taxablePartCents,
    allowanceUsedCents,
    taxableCents,
    capitalGainsTaxCents,
    soliCents,
    churchTaxCents,
    totalTaxCents,
    netValueCents: value - totalTaxCents,
  };
}

// ---------------------------------------------------------------------------
// Sondertilgung vs. ETF
// ---------------------------------------------------------------------------

export type PrepaymentMonthlyChannel = "special_repayment" | "rate_increase";

export interface PrepaymentLoanInput {
  balanceCents: number;
  interestRateBps: number;
  monthlyRateCents: number;
  repaymentType: RepaymentType | null;
  /** null = unbegrenzt (Legacy; specialRepaymentRule hat Vorrang, wenn gesetzt) */
  specialRepaymentMaxYearlyCents: number | null;
  specialRepaymentRule?: SpecialRepaymentRule;
  /** Optional upper bound on monthly rate from contractual corridor. */
  maxMonthlyRateCents?: number | null;
  /** Optional 1-based latest month index at which a rate change may start (0 = none allowed). */
  latestChangeMonth?: number | null;
}

export interface PrepaymentVsEtfInput {
  loan: PrepaymentLoanInput;
  startDate: string;
  horizonEndDate: string;
  oneTimeAmountCents: number;
  monthlyAmountCents: number;
  monthlyChannel?: PrepaymentMonthlyChannel;
  /** 1-based month index from which monthlyAmountCents applies (default 1). */
  monthlyStartMonth?: number;
  specialRepaymentUsedThisYearCents?: number;
  etfAnnualReturnBps: number;
  saverAllowanceCents: number;
  churchTaxBps: 0 | 800 | 900;
  partialExemptionBps?: number;
}

export interface PrepaymentVariantResult {
  remainingDebtCents: number;
  totalInterestCents: number;
  totalRegularPaymentCents: number;
  totalSpecialRepaymentCents: number;
  etfContributionsCents: number;
  etfGrossCents: number;
  etfTax: EtfTaxBreakdown;
  netWorthCents: number;
  totalCashOutCents: number;
  paidOffAtMonth: number | null;
}

export interface PrepaymentTimelinePoint {
  monthIndex: number;
  date: string;
  debtA: number;
  debtB: number;
  etfGrossA: number;
  etfGrossB: number;
  netWorthA: number;
  netWorthB: number;
}

export interface PrepaymentVsEtfResult {
  horizonMonths: number;
  prepayment: PrepaymentVariantResult;
  etf: PrepaymentVariantResult;
  netAdvantageEtfCents: number;
  winner: "etf" | "prepayment" | "equal";
  interestSavedCents: number;
  capLimitedOverflowCents: number;
  rateLimitedOverflowCents: number;
  flags: {
    capUnknown: boolean;
    capNone: boolean;
    rateBelowInterest: boolean;
    horizonElapsed: boolean;
  };
  timeline: PrepaymentTimelinePoint[];
}

interface VariantState {
  debt: number;
  etf: number;
  contributions: number;
  interest: number;
  regular: number;
  special: number;
  cashOut: number;
  paidOffAt: number | null;
}

function newVariantState(debt: number): VariantState {
  return {
    debt,
    etf: 0,
    contributions: 0,
    interest: 0,
    regular: 0,
    special: 0,
    cashOut: 0,
    paidOffAt: null,
  };
}

/**
 * Books one month of regular loan service on the state and returns the payment.
 */
function payRegular(
  state: VariantState,
  loan: PrepaymentLoanInput,
  month: number,
): number {
  if (state.debt === 0) {
    return 0;
  }
  const step = stepContractMonth(
    {
      category: "loan",
      repaymentType: loan.repaymentType,
      monthlyRateCents: loan.monthlyRateCents,
      interestRateBps: loan.interestRateBps,
    },
    state.debt,
  );
  state.debt = step.balanceCents;
  state.interest += step.interestCents;
  state.regular += step.paymentCents;
  if (step.paidOff && state.paidOffAt === null) {
    state.paidOffAt = month;
  }
  return step.paymentCents;
}

function validatePrepaymentInput(input: PrepaymentVsEtfInput): void {
  const { loan } = input;
  assertNonNegativeInteger(loan.balanceCents, "loan.balanceCents");
  assertNonNegativeInteger(loan.interestRateBps, "loan.interestRateBps");
  assertNonNegativeInteger(loan.monthlyRateCents, "loan.monthlyRateCents");
  if (loan.specialRepaymentMaxYearlyCents !== null) {
    assertNonNegativeInteger(
      loan.specialRepaymentMaxYearlyCents,
      "loan.specialRepaymentMaxYearlyCents",
    );
  }
  if (loan.maxMonthlyRateCents != null) {
    assertNonNegativeInteger(
      loan.maxMonthlyRateCents,
      "loan.maxMonthlyRateCents",
    );
  }
  if (loan.latestChangeMonth != null) {
    assertNonNegativeInteger(
      loan.latestChangeMonth,
      "loan.latestChangeMonth",
    );
  }
  assertNonNegativeInteger(input.oneTimeAmountCents, "oneTimeAmountCents");
  assertNonNegativeInteger(input.monthlyAmountCents, "monthlyAmountCents");
  if (input.monthlyStartMonth !== undefined) {
    const startMonth = assertSafeInteger(
      input.monthlyStartMonth,
      "monthlyStartMonth",
    );
    if (startMonth < 1) {
      throw new RangeError(
        `monthlyStartMonth must be >= 1, received: ${startMonth}`,
      );
    }
  }
  assertNonNegativeInteger(
    input.specialRepaymentUsedThisYearCents ?? 0,
    "specialRepaymentUsedThisYearCents",
  );
  parseIsoDate(input.startDate, "startDate");
  parseIsoDate(input.horizonEndDate, "horizonEndDate");
}

function resolveEffectiveRule(loan: PrepaymentLoanInput): SpecialRepaymentRule {
  if (loan.specialRepaymentRule !== undefined) {
    return loan.specialRepaymentRule;
  }
  if (loan.specialRepaymentMaxYearlyCents === null) {
    return { kind: "unknown" };
  }
  if (loan.specialRepaymentMaxYearlyCents === 0) {
    return { kind: "none" };
  }
  return { kind: "fixed", capCents: loan.specialRepaymentMaxYearlyCents };
}

export function simulatePrepaymentVsEtf(
  input: PrepaymentVsEtfInput,
): PrepaymentVsEtfResult {
  validatePrepaymentInput(input);
  const factor = computeMonthlyGrowthFactor(input.etfAnnualReturnBps);
  // Validate tax parameters up front (throws before any simulation work).
  const taxParams = {
    saverAllowanceCents: input.saverAllowanceCents,
    churchTaxBps: input.churchTaxBps,
    partialExemptionBps: input.partialExemptionBps,
  };
  calculateEtfLiquidationTax({ valueCents: 0, costBasisCents: 0, ...taxParams });

  const { loan } = input;
  const horizonMonths = countCompletedMonths(
    input.startDate,
    input.horizonEndDate,
  );
  if (horizonMonths > MAX_SCENARIO_MONTHS) {
    throw new RangeError(
      `horizon must be <= ${MAX_SCENARIO_MONTHS} months, received: ${horizonMonths}`,
    );
  }

  const effectiveRule = resolveEffectiveRule(loan);
  const capUnknown =
    effectiveRule.kind === "unknown" ||
    effectiveRule.kind === "allowed_unknown_amount";
  const capNone = effectiveRule.kind === "none";
  const monthlyChannel: PrepaymentMonthlyChannel =
    input.monthlyChannel ?? "special_repayment";
  const monthlyStartMonth = input.monthlyStartMonth ?? 1;

  const a = newVariantState(loan.balanceCents);
  const b = newVariantState(loan.balanceCents);

  const startYear = parseIsoDate(input.startDate, "startDate").year;
  let capYear = startYear;
  let cap = resolveYearlyCapCents(effectiveRule, a.debt) ?? Number.MAX_SAFE_INTEGER;
  let capUsed = input.specialRepaymentUsedThisYearCents ?? 0;
  let capLimitedOverflowCents = 0;
  let rateLimitedOverflowCents = 0;

  const taxNet = (etf: number, contributions: number): number =>
    calculateEtfLiquidationTax({
      valueCents: etf,
      costBasisCents: contributions,
      ...taxParams,
    }).netValueCents;

  const timeline: PrepaymentTimelinePoint[] = [];
  const pushPoint = (monthIndex: number): void => {
    timeline.push({
      monthIndex,
      date: addMonthsToIsoDate(input.startDate, monthIndex),
      debtA: a.debt,
      debtB: b.debt,
      etfGrossA: a.etf,
      etfGrossB: b.etf,
      netWorthA: taxNet(a.etf, a.contributions) - a.debt,
      netWorthB: taxNet(b.etf, b.contributions) - b.debt,
    });
  };

  // Variant A: apply special repayment limited by debt and yearly cap, rest to ETF.
  const applyToA = (availableCents: number, month: number): void => {
    const res = applyCappedSpecialRepayment(
      a.debt,
      availableCents,
      Math.max(0, cap - capUsed),
    );
    capLimitedOverflowCents += res.capOverflowCents;
    capUsed += res.appliedCents;
    a.debt -= res.appliedCents;
    a.special += res.appliedCents;
    const toEtf = availableCents - res.appliedCents;
    a.etf += toEtf;
    a.contributions += toEtf;
    if (a.debt === 0 && a.paidOffAt === null) {
      a.paidOffAt = month;
    }
  };

  // Month 0
  applyToA(input.oneTimeAmountCents, 0);
  a.cashOut += input.oneTimeAmountCents;
  b.etf += input.oneTimeAmountCents;
  b.contributions += input.oneTimeAmountCents;
  b.cashOut += input.oneTimeAmountCents;
  if (b.debt === 0) {
    b.paidOffAt = 0;
  }
  if (a.debt === 0) {
    a.paidOffAt = 0;
  }
  pushPoint(0);

  for (let t = 1; t <= horizonMonths; t += 1) {
    const yearOfMonth = parseIsoDate(
      addMonthsToIsoDate(input.startDate, t),
      "date",
    ).year;
    if (yearOfMonth !== capYear) {
      capYear = yearOfMonth;
      capUsed = 0;
      cap =
        resolveYearlyCapCents(effectiveRule, a.debt) ?? Number.MAX_SAFE_INTEGER;
    }

    a.etf = applyMonthlyGrowth(a.etf, factor);
    b.etf = applyMonthlyGrowth(b.etf, factor);

    const activeMonthly = t >= monthlyStartMonth ? input.monthlyAmountCents : 0;

    if (monthlyChannel === "rate_increase") {
      const startAllowed =
        loan.latestChangeMonth == null ||
        monthlyStartMonth <= loan.latestChangeMonth;
      const maxIncrease = !startAllowed
        ? 0
        : loan.maxMonthlyRateCents != null
          ? Math.max(0, loan.maxMonthlyRateCents - loan.monthlyRateCents)
          : activeMonthly;
      const appliedIncrease = Math.min(activeMonthly, maxIncrease);
      rateLimitedOverflowCents += activeMonthly - appliedIncrease;

      const loanForA: PrepaymentLoanInput =
        appliedIncrease > 0
          ? {
              ...loan,
              monthlyRateCents: loan.monthlyRateCents + appliedIncrease,
            }
          : loan;
      const paymentA = payRegular(a, loanForA, t);
      const paymentB = payRegular(b, loan, t);
      const budget = paymentB + activeMonthly;
      const freeA = Math.max(0, budget - paymentA);

      a.etf += freeA;
      a.contributions += freeA;
      a.cashOut += paymentA + freeA;

      b.etf += activeMonthly;
      b.contributions += activeMonthly;
      b.cashOut += paymentB + activeMonthly;
    } else {
      const paymentA = payRegular(a, loan, t);
      const paymentB = payRegular(b, loan, t);
      const budget = paymentB + activeMonthly;
      const freeA = Math.max(0, budget - paymentA);

      applyToA(freeA, t);
      a.cashOut += paymentA + freeA;

      b.etf += activeMonthly;
      b.contributions += activeMonthly;
      b.cashOut += paymentB + activeMonthly;
    }

    pushPoint(t);
  }

  const buildVariant = (s: VariantState): PrepaymentVariantResult => {
    const etfTax = calculateEtfLiquidationTax({
      valueCents: s.etf,
      costBasisCents: s.contributions,
      ...taxParams,
    });
    return {
      remainingDebtCents: s.debt,
      totalInterestCents: s.interest,
      totalRegularPaymentCents: s.regular,
      totalSpecialRepaymentCents: s.special,
      etfContributionsCents: s.contributions,
      etfGrossCents: s.etf,
      etfTax,
      netWorthCents: etfTax.netValueCents - s.debt,
      totalCashOutCents: s.cashOut,
      paidOffAtMonth: s.paidOffAt,
    };
  };

  const prepayment = buildVariant(a);
  const etf = buildVariant(b);
  const netAdvantageEtfCents = etf.netWorthCents - prepayment.netWorthCents;

  const isAnnuityLike =
    loan.repaymentType === null || loan.repaymentType === "annuity";
  const rateBelowInterest =
    isAnnuityLike &&
    loan.balanceCents > 0 &&
    loan.monthlyRateCents <
      calculateMonthlyInterestCents(loan.balanceCents, loan.interestRateBps);

  return {
    horizonMonths,
    prepayment,
    etf,
    netAdvantageEtfCents,
    winner:
      netAdvantageEtfCents === 0
        ? "equal"
        : netAdvantageEtfCents > 0
          ? "etf"
          : "prepayment",
    interestSavedCents: etf.totalInterestCents - prepayment.totalInterestCents,
    capLimitedOverflowCents,
    rateLimitedOverflowCents,
    flags: {
      capUnknown,
      capNone,
      rateBelowInterest,
      horizonElapsed: input.horizonEndDate <= input.startDate,
    },
    timeline,
  };
}

export type BreakEvenResult =
  | { kind: "identical" }
  | { kind: "unreachable" }
  | { kind: "bps"; bps: number };

/**
 * Smallest integer-bps ETF return in [0, MAX_ETF_RETURN_BPS] at which the ETF
 * path is at least as good as special repayment / rate increase.
 * - identical: A and B have identical debt/payment trajectories (never prepays
 *   or raises rate, or no horizon), so there is no break-even.
 * - unreachable: even at MAX_ETF_RETURN_BPS the ETF stays behind.
 */
export function findBreakEvenReturnBps(
  input: Omit<PrepaymentVsEtfInput, "etfAnnualReturnBps">,
): BreakEvenResult {
  const run = (bps: number) =>
    simulatePrepaymentVsEtf({ ...input, etfAnnualReturnBps: bps });

  const atZero = run(0);
  const pathsIdentical =
    atZero.horizonMonths === 0 ||
    (atZero.prepayment.totalSpecialRepaymentCents === 0 &&
      atZero.prepayment.totalRegularPaymentCents ===
        atZero.etf.totalRegularPaymentCents &&
      atZero.prepayment.remainingDebtCents === atZero.etf.remainingDebtCents);
  if (pathsIdentical) {
    return { kind: "identical" };
  }
  if (atZero.netAdvantageEtfCents >= 0) {
    return { kind: "bps", bps: 0 };
  }
  if (run(MAX_ETF_RETURN_BPS).netAdvantageEtfCents < 0) {
    return { kind: "unreachable" };
  }

  let low = 0; // advantage < 0
  let high = MAX_ETF_RETURN_BPS; // advantage >= 0
  while (high - low > 1) {
    const mid = Math.floor((low + high) / 2);
    if (run(mid).netAdvantageEtfCents >= 0) {
      high = mid;
    } else {
      low = mid;
    }
  }
  return { kind: "bps", bps: high };
}

export interface PrepaymentDefaults {
  loan: PrepaymentLoanInput;
  startDate: string;
  horizonEndDate: string;
  horizonEstimated: boolean;
  capUnknown: boolean;
  specialAllowance: SpecialRepaymentAllowance;
  rateCorridor: RateCorridor;
}

export function buildPrepaymentDefaults(
  contract: DomainContract,
  asOfDate: string,
): PrepaymentDefaults {
  if (contract.category !== "loan") {
    throw new RangeError(
      `Prepayment scenarios require category "loan", received: "${contract.category}"`,
    );
  }
  parseIsoDate(asOfDate, "asOfDate");
  const projection = projectContractBalance(contract, asOfDate);
  const rule = specialRepaymentRule(contract);
  const specialAllowance = remainingSpecialRepaymentCents(
    contract,
    asOfDate,
    projection.projectedBalanceCents,
  );
  const rateCorridor = resolveRateCorridor(
    contract,
    asOfDate,
    projection.projectedBalanceCents,
  );
  const horizonEstimated = contract.fixedInterestUntil == null;

  const maxMonthlyRateCents =
    rateCorridor.status === "none" ||
    rateCorridor.status === "not_applicable" ||
    rateCorridor.flags.exhausted ||
    rateCorridor.flags.corridorEmpty
      ? contract.monthlyRateCents
      : rateCorridor.maxMonthlyCents;
  const latestChangeMonth =
    rateCorridor.latestChangeDate != null
      ? rateCorridor.latestChangeDate >= asOfDate
        ? countCompletedMonths(asOfDate, rateCorridor.latestChangeDate)
        : 0
      : null;

  return {
    loan: {
      balanceCents: projection.projectedBalanceCents,
      interestRateBps: contract.interestRateBps,
      monthlyRateCents: contract.monthlyRateCents,
      repaymentType: contract.repaymentType ?? null,
      specialRepaymentMaxYearlyCents: specialAllowance.capCents,
      specialRepaymentRule: rule,
      maxMonthlyRateCents,
      latestChangeMonth,
    },
    startDate: asOfDate,
    horizonEndDate:
      contract.fixedInterestUntil ??
      addMonthsToIsoDate(asOfDate, DEFAULT_ESTIMATED_HORIZON_MONTHS),
    horizonEstimated,
    capUnknown: specialAllowance.flags.capUnknown,
    specialAllowance,
    rateCorridor,
  };
}

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
