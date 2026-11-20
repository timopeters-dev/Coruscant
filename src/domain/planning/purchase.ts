import { calculateMonthlyInterestCents } from "@/domain/contracts/contract";
import {
  assertNonNegativeInteger,
  assertSafeInteger,
  divRoundHalfUpSigned,
  roundHalfUpBigInt,
} from "@/domain/core/money";
import type { DeadlinePotInput, PotDeadlineEvaluation } from "@/domain/allocation/pot-deadline";
import {
  PROPERTY_PURCHASE_LIMITS,
  type PurchaseCostItemInput,
} from "./purchase-defaults";

const BPS_DENOMINATOR = 10_000n;
const MONTHS_PER_YEAR_IN_BPS_DENOMINATOR = 120_000n;

export interface PropertyPurchaseInput {
  purchasePriceCents: number;
  costItems: readonly PurchaseCostItemInput[];
  equityCents: number;
  requireEquityCoversCosts: boolean;
  interestRateBps: number;
  initialRepaymentBps: number;
  fixedRateYears: number;
  monthlyColdRentCents: number;
  monthlyNonRecoverableCostsCents: number;
  monthlyMaintenanceCents: number;
}

export type BreakEvenEquity =
  | { kind: "unreachable" }
  | { kind: "at_minimum"; equityCents: number }
  | { kind: "amount"; equityCents: number };

export interface PropertyPurchaseResult {
  costs: {
    items: { key: string; label: string; bps: number; amountCents: number }[];
    purchaseCostsCents: number;
    totalCostsCents: number;
  };
  equity: {
    inputCents: number;
    minimumCents: number;
    requiredCents: number;
    surplusEquityCents: number;
    shortfallToMinimumCents: number;
  };
  loan: {
    principalCents: number;
    monthlyRateCents: number;
    firstMonthInterestCents: number;
    firstMonthPrincipalCents: number;
    fixedRateMonths: number;
    remainingDebtCents: number;
    totalInterestInFixedPeriodCents: number;
    paidOffInMonth: number | null;
  };
  cashflow: {
    netRentBeforeDebtServiceCents: number;
    monthlyCashflowCents: number;
  };
  yields: {
    grossYieldBps: number | null;
    netYieldBps: number | null;
  };
  breakEven: {
    monthlyColdRentCents: number;
    equity: BreakEvenEquity;
    equityGapToBreakEvenCents: number | null;
  };
  flags: {
    noLoan: boolean;
    equityExceedsTotal: boolean;
    belowMinimumEquity: boolean;
    loanFinancesPurchaseCosts: boolean;
    noAmortization: boolean;
  };
}

export interface EquitySourceEvaluation {
  potId: string;
  potName: string;
  currentCents: number;
  targetCents: number | null;
  gapNowCents: number;
  coveredNow: boolean;
  targetCoversRequirement: boolean | null;
  targetShortfallCents: number;
  deadline: PotDeadlineEvaluation | null;
}

export interface HouseholdImpact {
  monthlySurplusBeforeCents: number;
  objectCashflowCents: number;
  monthlySurplusAfterCents: number;
  isDeficitAfter: boolean;
  objectBurdenCents: number;
}

function assertInRange(
  value: number,
  min: number,
  max: number,
  fieldName: string,
): number {
  const safe = assertNonNegativeInteger(value, fieldName);
  if (safe < min || safe > max) {
    throw new RangeError(
      `${fieldName} must be between ${min} and ${max}, received: ${safe}`,
    );
  }
  return safe;
}

function validatePropertyPurchaseInput(input: PropertyPurchaseInput): void {
  const limits = PROPERTY_PURCHASE_LIMITS;
  assertInRange(
    input.purchasePriceCents,
    limits.purchasePriceCents.min,
    limits.purchasePriceCents.max,
    "purchasePriceCents",
  );
  assertInRange(
    input.equityCents,
    limits.equityCents.min,
    limits.equityCents.max,
    "equityCents",
  );
  assertInRange(
    input.interestRateBps,
    limits.interestRateBps.min,
    limits.interestRateBps.max,
    "interestRateBps",
  );
  assertInRange(
    input.initialRepaymentBps,
    limits.initialRepaymentBps.min,
    limits.initialRepaymentBps.max,
    "initialRepaymentBps",
  );
  assertInRange(
    input.fixedRateYears,
    limits.fixedRateYears.min,
    limits.fixedRateYears.max,
    "fixedRateYears",
  );
  assertInRange(
    input.monthlyColdRentCents,
    limits.monthlyColdRentCents.min,
    limits.monthlyColdRentCents.max,
    "monthlyColdRentCents",
  );
  assertInRange(
    input.monthlyNonRecoverableCostsCents,
    limits.monthlyNonRecoverableCostsCents.min,
    limits.monthlyNonRecoverableCostsCents.max,
    "monthlyNonRecoverableCostsCents",
  );
  assertInRange(
    input.monthlyMaintenanceCents,
    limits.monthlyMaintenanceCents.min,
    limits.monthlyMaintenanceCents.max,
    "monthlyMaintenanceCents",
  );

  if (
    input.costItems.length < limits.costItems.minCount ||
    input.costItems.length > limits.costItems.maxCount
  ) {
    throw new RangeError(
      `costItems must contain between ${limits.costItems.minCount} and ${limits.costItems.maxCount} items, received: ${input.costItems.length}`,
    );
  }

  const seenKeys = new Set<string>();
  for (let i = 0; i < input.costItems.length; i += 1) {
    const item = input.costItems[i]!;
    if (item.key.trim().length === 0) {
      throw new RangeError(`costItems[${i}].key must not be empty`);
    }
    if (seenKeys.has(item.key)) {
      throw new RangeError(`Duplicate costItem key: "${item.key}"`);
    }
    seenKeys.add(item.key);

    const labelLen = item.label.trim().length;
    if (
      labelLen < limits.costItems.minLabelLength ||
      labelLen > limits.costItems.maxLabelLength
    ) {
      throw new RangeError(
        `costItems[${i}].label length must be between ${limits.costItems.minLabelLength} and ${limits.costItems.maxLabelLength}`,
      );
    }

    assertInRange(
      item.bps,
      limits.costItems.minBps,
      limits.costItems.maxBps,
      `costItems[${i}].bps`,
    );
  }
}

/**
 * Calculates the monthly annuity rate using the German initial-repayment convention:
 * roundHalfUp(principalCents * (interestRateBps + initialRepaymentBps), 120_000).
 */
export function calculateLoanMonthlyRateCents(
  principalCents: number,
  interestRateBps: number,
  initialRepaymentBps: number,
): number {
  const safePrincipal = assertNonNegativeInteger(
    principalCents,
    "principalCents",
  );
  const safeInterest = assertNonNegativeInteger(
    interestRateBps,
    "interestRateBps",
  );
  const safeRepayment = assertNonNegativeInteger(
    initialRepaymentBps,
    "initialRepaymentBps",
  );

  const totalBps = safeInterest + safeRepayment;
  if (safePrincipal === 0 || totalBps === 0) {
    return 0;
  }

  const rate = roundHalfUpBigInt(
    BigInt(safePrincipal) * BigInt(totalBps),
    MONTHS_PER_YEAR_IN_BPS_DENOMINATOR,
  );
  return assertSafeInteger(Number(rate), "monthlyRateCents");
}

/**
 * Projects remaining loan debt month-by-month over `months` using the same
 * monthly interest rounding as contract projections.
 */
export function projectRemainingDebt(
  principalCents: number,
  interestRateBps: number,
  monthlyRateCents: number,
  months: number,
): {
  remainingDebtCents: number;
  totalInterestCents: number;
  paidOffInMonth: number | null;
} {
  let debt = assertNonNegativeInteger(principalCents, "principalCents");
  const safeInterest = assertNonNegativeInteger(
    interestRateBps,
    "interestRateBps",
  );
  const safeRate = assertNonNegativeInteger(
    monthlyRateCents,
    "monthlyRateCents",
  );
  const safeMonths = assertNonNegativeInteger(months, "months");

  let totalInterestCents = 0;
  let paidOffInMonth: number | null = null;

  for (let month = 1; month <= safeMonths; month += 1) {
    if (debt === 0) {
      break;
    }
    const interest = calculateMonthlyInterestCents(debt, safeInterest);
    totalInterestCents += interest;
    const totalDue = debt + interest;
    const payment = Math.min(safeRate, totalDue);
    debt = totalDue - payment;
    if (debt === 0 && paidOffInMonth === null) {
      paidOffInMonth = month;
    }
  }

  return {
    remainingDebtCents: debt,
    totalInterestCents: assertSafeInteger(
      totalInterestCents,
      "totalInterestCents",
    ),
    paidOffInMonth,
  };
}

/**
 * Closed-form maximum loan principal L* such that calculateLoanMonthlyRateCents(L*, i, t) <= netRentCents.
 * Returns null if netRentCents < 0.
 */
export function findMaxSelfSustainingLoanCents(
  netRentCents: number,
  interestRateBps: number,
  initialRepaymentBps: number,
  maxLoanCents?: number,
): number | null {
  const safeNetRent = assertSafeInteger(netRentCents, "netRentCents");
  const safeInterest = assertNonNegativeInteger(
    interestRateBps,
    "interestRateBps",
  );
  const safeRepayment = assertNonNegativeInteger(
    initialRepaymentBps,
    "initialRepaymentBps",
  );
  const safeMaxLoan =
    maxLoanCents == null
      ? null
      : assertNonNegativeInteger(maxLoanCents, "maxLoanCents");

  if (safeNetRent < 0) {
    return null;
  }

  const k = BigInt(safeInterest) + BigInt(safeRepayment);
  if (k === 0n) {
    return safeMaxLoan ?? Number.MAX_SAFE_INTEGER;
  }

  // rate(L) <= R  <=>  2*L*k + 120_000 < 240_000*(R + 1)
  // <=>  L* = floor((120_000*(2R + 1) - 1) / (2k))
  const numerator =
    MONTHS_PER_YEAR_IN_BPS_DENOMINATOR * (2n * BigInt(safeNetRent) + 1n) - 1n;
  const maxL = numerator / (2n * k);

  if (safeMaxLoan !== null && maxL >= BigInt(safeMaxLoan)) {
    return safeMaxLoan;
  }

  return assertSafeInteger(Number(maxL), "maxSelfSustainingLoanCents");
}

/**
 * Simulates a property purchase before taxes (pure, stateless).
 */
export function calculatePropertyPurchase(
  input: PropertyPurchaseInput,
): PropertyPurchaseResult {
  validatePropertyPurchaseInput(input);

  const items = input.costItems.map((item) => {
    const amount = roundHalfUpBigInt(
      BigInt(input.purchasePriceCents) * BigInt(item.bps),
      BPS_DENOMINATOR,
    );
    return {
      key: item.key,
      label: item.label,
      bps: item.bps,
      amountCents: assertSafeInteger(Number(amount), `costItem.${item.key}`),
    };
  });

  const purchaseCostsCents = assertSafeInteger(
    items.reduce((sum, item) => sum + item.amountCents, 0),
    "purchaseCostsCents",
  );
  const totalCostsCents = assertSafeInteger(
    input.purchasePriceCents + purchaseCostsCents,
    "totalCostsCents",
  );

  const minimumCents = input.requireEquityCoversCosts ? purchaseCostsCents : 0;
  const cappedInputEquity = Math.min(input.equityCents, totalCostsCents);
  const requiredCents = Math.max(cappedInputEquity, minimumCents);
  const surplusEquityCents = Math.max(0, input.equityCents - totalCostsCents);
  const shortfallToMinimumCents = Math.max(0, minimumCents - input.equityCents);

  const principalCents = totalCostsCents - requiredCents;
  const monthlyRateCents = calculateLoanMonthlyRateCents(
    principalCents,
    input.interestRateBps,
    input.initialRepaymentBps,
  );
  const firstMonthInterestCents = calculateMonthlyInterestCents(
    principalCents,
    input.interestRateBps,
  );
  const firstMonthPrincipalCents = Math.max(
    0,
    Math.min(principalCents, monthlyRateCents - firstMonthInterestCents),
  );

  const fixedRateMonths = input.fixedRateYears * 12;
  const debtProjection = projectRemainingDebt(
    principalCents,
    input.interestRateBps,
    monthlyRateCents,
    fixedRateMonths,
  );

  const netRentBeforeDebtServiceCents =
    input.monthlyColdRentCents -
    input.monthlyNonRecoverableCostsCents -
    input.monthlyMaintenanceCents;
  const monthlyCashflowCents = netRentBeforeDebtServiceCents - monthlyRateCents;

  const grossYieldBps =
    input.purchasePriceCents === 0
      ? null
      : divRoundHalfUpSigned(
          12n * BigInt(input.monthlyColdRentCents) * BPS_DENOMINATOR,
          BigInt(input.purchasePriceCents),
        );
  const netYieldBps =
    totalCostsCents === 0
      ? null
      : divRoundHalfUpSigned(
          12n * BigInt(netRentBeforeDebtServiceCents) * BPS_DENOMINATOR,
          BigInt(totalCostsCents),
        );

  const breakEvenMonthlyColdRentCents =
    monthlyRateCents +
    input.monthlyNonRecoverableCostsCents +
    input.monthlyMaintenanceCents;

  const maxLoanAtMinimum = totalCostsCents - minimumCents;
  let breakEvenEquity: BreakEvenEquity;
  if (netRentBeforeDebtServiceCents < 0) {
    breakEvenEquity = { kind: "unreachable" };
  } else if (input.interestRateBps + input.initialRepaymentBps === 0) {
    breakEvenEquity = { kind: "at_minimum", equityCents: minimumCents };
  } else {
    const maxSelfSustainingLoan = findMaxSelfSustainingLoanCents(
      netRentBeforeDebtServiceCents,
      input.interestRateBps,
      input.initialRepaymentBps,
      maxLoanAtMinimum,
    )!;
    if (maxSelfSustainingLoan >= maxLoanAtMinimum) {
      breakEvenEquity = { kind: "at_minimum", equityCents: minimumCents };
    } else {
      breakEvenEquity = {
        kind: "amount",
        equityCents: totalCostsCents - maxSelfSustainingLoan,
      };
    }
  }

  const equityGapToBreakEvenCents =
    breakEvenEquity.kind === "unreachable"
      ? null
      : breakEvenEquity.equityCents - requiredCents;

  return {
    costs: {
      items,
      purchaseCostsCents,
      totalCostsCents,
    },
    equity: {
      inputCents: input.equityCents,
      minimumCents,
      requiredCents,
      surplusEquityCents,
      shortfallToMinimumCents,
    },
    loan: {
      principalCents,
      monthlyRateCents,
      firstMonthInterestCents,
      firstMonthPrincipalCents,
      fixedRateMonths,
      remainingDebtCents: debtProjection.remainingDebtCents,
      totalInterestInFixedPeriodCents: debtProjection.totalInterestCents,
      paidOffInMonth: debtProjection.paidOffInMonth,
    },
    cashflow: {
      netRentBeforeDebtServiceCents,
      monthlyCashflowCents,
    },
    yields: {
      grossYieldBps,
      netYieldBps,
    },
    breakEven: {
      monthlyColdRentCents: breakEvenMonthlyColdRentCents,
      equity: breakEvenEquity,
      equityGapToBreakEvenCents,
    },
    flags: {
      noLoan: principalCents === 0,
      equityExceedsTotal: input.equityCents > totalCostsCents,
      belowMinimumEquity: input.equityCents < minimumCents,
      loanFinancesPurchaseCosts:
        !input.requireEquityCoversCosts &&
        principalCents > input.purchasePriceCents,
      noAmortization:
        principalCents > 0 && monthlyRateCents <= firstMonthInterestCents,
    },
  };
}

export function evaluateEquitySource(input: {
  requiredEquityCents: number;
  pot: DeadlinePotInput | null;
  deadlines: readonly PotDeadlineEvaluation[];
}): EquitySourceEvaluation | null {
  const required = assertNonNegativeInteger(
    input.requiredEquityCents,
    "requiredEquityCents",
  );
  if (input.pot === null) {
    return null;
  }

  const currentCents = assertNonNegativeInteger(
    input.pot.currentCents,
    "pot.currentCents",
  );
  const targetCents =
    input.pot.targetCents == null
      ? null
      : assertNonNegativeInteger(input.pot.targetCents, "pot.targetCents");

  const gapNowCents = Math.max(0, required - currentCents);
  const coveredNow = currentCents >= required;
  const targetCoversRequirement =
    targetCents === null ? null : targetCents >= required;
  const targetShortfallCents =
    targetCents === null ? 0 : Math.max(0, required - targetCents);
  const deadline =
    input.deadlines.find((item) => item.potId === input.pot!.id) ?? null;

  return {
    potId: input.pot.id,
    potName: input.pot.name,
    currentCents,
    targetCents,
    gapNowCents,
    coveredNow,
    targetCoversRequirement,
    targetShortfallCents,
    deadline,
  };
}

export function calculateHouseholdImpact(
  monthlySurplusCents: number,
  objectCashflowCents: number,
): HouseholdImpact {
  const before = assertSafeInteger(
    monthlySurplusCents,
    "monthlySurplusCents",
  );
  const cashflow = assertSafeInteger(
    objectCashflowCents,
    "objectCashflowCents",
  );
  const after = assertSafeInteger(
    before + cashflow,
    "monthlySurplusAfterCents",
  );

  return {
    monthlySurplusBeforeCents: before,
    objectCashflowCents: cashflow,
    monthlySurplusAfterCents: after,
    isDeficitAfter: after < 0,
    objectBurdenCents: Math.max(0, -cashflow),
  };
}
