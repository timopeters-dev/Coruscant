/** Typen und Grenzen der Tilgungs- und Sparverläufe. */
import { type ContractCategory } from "./contract";

export const MAX_SERIES_MONTHS = 480;
export const DEFAULT_FLAT_HORIZON_MONTHS = 120;
export const OVERVIEW_SPARKLINE_MAX_POINTS = 24;

export interface SpecialRepaymentOption {
  amountCents: number;
  date: string;
  repeatYearly: boolean;
  usedThisYearCents?: number;
}

export interface RateChangeOption {
  date: string;
  newMonthlyRateCents: number;
}

export interface AmortizationOptions {
  asOfDate: string;
  specialRepayment?: SpecialRepaymentOption | null;
  rateChange?: RateChangeOption | null;
  maxMonths?: number;
}

export interface AmortizationPoint {
  monthIndex: number;
  date: string;
  balanceCents: number;
  cumulativeInterestCents: number;
  cumulativeSpecialCents: number;
  interestCents: number;
  principalCents: number;
  specialCents: number;
  monthlyRateCents: number;
  phase: "calibrated" | "since_calibration" | "future";
  afterFixedInterestEnd: boolean;
}

export type AmortizationMarkerKind =
  | "today"
  | "fixed_interest_end"
  | "milestone"
  | "paid_off"
  | "allocation_threshold"
  | "target_reached"
  | "special_repayment"
  | "rate_change";

export interface AmortizationMarker {
  kind: AmortizationMarkerKind;
  date: string;
  monthIndex: number;
  label: string;
  balanceCents: number | null;
}

export interface RateChangeSummary {
  requestedCents: number;
  appliedCents: number;
  clamped: boolean;
  notAllowed: boolean;
  afterLatestDate: boolean;
}

export interface AmortizationSeriesResult {
  contractId: string;
  category: ContractCategory;
  startDate: string;
  asOfDate: string;
  asOfMonthIndex: number;
  points: AmortizationPoint[];
  markers: AmortizationMarker[];
  paidOffMonthIndex: number | null;
  paidOffDate: string | null;
  totalInterestCents: number;
  interestUntilFixedEndCents: number | null;
  balanceAtFixedInterestEndCents: number | null;
  targetReachedDate: string | null;
  allocationThresholdDate: string | null;
  allocationThresholdCents: number | null;
  special: {
    requestedCents: number;
    appliedCents: number;
    capOverflowCents: number;
    exceedsDebtCents: number;
    afterPayoffIgnoredCents: number;
  } | null;
  rateChange: RateChangeSummary | null;
  flags: {
    notProjected: boolean;
    neverPaysOff: boolean;
    rateBelowInterest: boolean;
    noRate: boolean;
    lumpSum: boolean;
    horizonCapped: boolean;
    capUnknown: boolean;
    missingFixedInterestEnd: boolean;
    assumesSameRateAfterFixedEnd: boolean;
    staleCalibration: boolean;
    calibrationAgeMonths: number;
  };
}

export interface YearlyPaymentSplitRow {
  year: number;
  interestCents: number;
  principalCents: number;
  specialCents: number;
  endBalanceCents: number;
}

export interface YearlyPaymentSplitSummary {
  rows: YearlyPaymentSplitRow[];
  crossoverDate: string | null;
}

export interface LoanAdjustmentEffect {
  baseline: AmortizationSeriesResult;
  adjusted: AmortizationSeriesResult;
  balanceAtFixedEndDeltaCents: number | null;
  interestSavedUntilFixedEndCents: number | null;
  interestSavedTotalCents: number;
  monthsSaved: number | null;
  extraPaidUntilFixedEndCents: number | null;
  extraPaidTotalCents: number;
  crossover: {
    baseline: string | null;
    adjusted: string | null;
  };
}

export interface SpecialRepaymentEffect {
  baseline: AmortizationSeriesResult;
  withSpecial: AmortizationSeriesResult;
  balanceAtFixedEndDeltaCents: number | null;
  interestSavedUntilFixedEndCents: number | null;
  interestSavedTotalCents: number;
  monthsSaved: number | null;
}

export interface RateChangeTimingPoint {
  startDate: string;
  interestSavedCents: number;
}

export interface RateChangeTimingResult {
  points: RateChangeTimingPoint[];
  costPerYearDelayCents: number | null;
}

export interface ContractOverview {
  sparklineCents: number[];
  paidOffDate: string | null;
  neverPaysOff: boolean;
  notProjected: boolean;
  lumpSum: boolean;
  targetProgressBps: number | null;
  thresholdBps: number | null;
  calibrationAgeMonths: number;
  isCalibrationStale: boolean;
}
