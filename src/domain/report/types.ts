/** Struktur des Berater-Berichts (vollständig, vor der Anonymisierung). */
import { type BalanceSummary } from "@/domain/cockpit/balance";
import { type BalanceHistoryPoint } from "@/domain/cockpit/balance-history";
import type {
  ConsolidatedCashflowSummary, VariableExpenseBasis,
} from "@/domain/allocation/cashflow";
import { type ContractCategory, type RepaymentType } from "@/domain/contracts/contract";
import type {
  OptionRight, RateChangeScope, RateCorridor, SpecialRepaymentAllowance, SpecialRepaymentBasis,
} from "@/domain/contracts/loan-options";
import { type PotDeadlineStatus } from "@/domain/allocation/pot-deadline";
import {
  type DomainLinkedContract, type DomainPropertyDetail, type PropertyUsage,
} from "@/domain/properties/properties";
import {
  type RecommendationPot, type RecommendationResult, type RecommendationState,
} from "@/domain/recommendation/types";
import { type DomainRentalProfile } from "@/domain/properties/rental";
import type { PotRuleType } from "@/domain/allocation/waterfall";

export const ADVISOR_REPORT_SCHEMA_VERSION = 1;
export const ADVISOR_STALE_SNAPSHOT_DAYS = 7;
export const ADVISOR_HISTORY_MONTHS = 12;
export const ADVISOR_MIN_ONE_TIME_CENTS = 100;
export const ADVISOR_MAX_ONE_TIME_CENTS = 1_000_000_000;
export const ADVISOR_DISCLAIMER =
  "Orientierung, keine Anlageberatung. Alle Werte stammen aus der lokalen Haushalts-App; Schätzungen und Projektionen sind als „Modelliert“ gekennzeichnet.";

export type AdvisorReportMode = "full" | "anonymized";

export type AdvisorEntityKey =
  | `contract:${string}`
  | `property:${string}`
  | `pot:${string}`;

export interface AdvisorReportInput {
  asOfDate: string;
  generatedAt: string;
  snapshotFetchedAt: string | null;
  isDummyHousehold: boolean;
  balance: BalanceSummary;
  properties: (DomainPropertyDetail & Partial<DomainRentalProfile>)[];
  contracts: (DomainLinkedContract & {
    provider: string | null;
    futureLoanInterestRateBps: number | null;
  })[];
  pots: (RecommendationPot & {
    linkedPropertyId: string | null;
    liquidityExclusion: "link_conflict" | "out_of_scope" | null;
  })[];
  cashflow: ConsolidatedCashflowSummary;
  history: readonly BalanceHistoryPoint[];
  recommendationState: RecommendationState;
  oneTimeAmountCents: number | null;
}

export type AdvisorDataQualityHint =
  | { code: "NO_SNAPSHOT" }
  | { code: "SNAPSHOT_STALE"; ageDays: number }
  | { code: "DUMMY_HOUSEHOLD" }
  | { code: "NO_HOUSEHOLD_CASHFLOW" }
  | { code: "PROJECTED_CONTRACTS"; count: number }
  | { code: "STALE_CALIBRATION"; count: number }
  | { code: "EXCLUDED_POTS"; count: number; cents: number }
  | { code: "HISTORY_SPARSE"; monthCount: number }
  | { code: "PROPERTY_VALUES_ESTIMATED"; count: number };

export interface AdvisorReportMeta {
  schemaVersion: number;
  asOfDate: string;
  generatedAt: string;
  disclaimer: string;
}

export interface AdvisorReportProfile {
  propertyCount: number;
  ownerOccupiedCount: number;
  rentedCount: number;
  loanCount: number;
  savingsContractCount: number;
  potCount: number;
  hasHouseholdCashflow: boolean;
  emergencyCoverageMonthsTenths: number | null;
}

export interface AdvisorReportBalance extends BalanceSummary {
  freeShareBps: number;
  boundShareBps: number;
  liabilitiesShareBps: number;
  excludedPotsCents: number;
  isModeled: boolean;
}

export interface AdvisorReportLoanOptions {
  originalPrincipalCents: number | null;
  specialRepayment: {
    status: OptionRight;
    basis: SpecialRepaymentBasis | null;
    percentBps: number | null;
    capThisYearCents: number | null;
    usedThisYearCents: number;
    remainingThisYearCents: number | null;
    flags: SpecialRepaymentAllowance["flags"];
  };
  rateChange: {
    status: RateCorridor["status"];
    totalCount: number | null;
    usedCount: number;
    remainingChanges: number | null;
    scope: RateChangeScope | null;
    minRepaymentBps: number | null;
    maxRepaymentBps: number | null;
    minMonthlyCents: number | null;
    maxMonthlyCents: number | null;
    currentRepaymentBpsApprox: number | null;
    latestChangeDate: string | null;
    flags: RateCorridor["flags"];
  };
  hasNote: boolean;
}

export interface AdvisorReportContract {
  entityKey: `contract:${string}`;
  category: ContractCategory;
  status: "active" | "paused";
  projectedBalanceCents: number;
  isProjected: boolean;
  calibratedAsOf: string;
  calibrationStale: boolean;
  interestRateBps: number;
  monthlyRateCents: number;
  repaymentType: RepaymentType | null;
  fixedInterestUntil: string | null;
  futureLoanInterestRateBps: number | null;
  specialRepaymentMaxYearlyCents: number | null;
  loanOptions: AdvisorReportLoanOptions | null;
  targetSumCents: number | null;
  targetProgressBps: number | null;
  linkedPropertyKey: `property:${string}` | null;
  milestone: { date: string; hasLabel: boolean } | null;
}

export interface AdvisorReportRentalDetails {
  monthlyColdRentCents: number;
  monthlyNonRecoverableCostsCents: number;
  monthlyMaintenanceAllowanceCents: number;
  netCashflowBeforeReserveCents: number;
  grossYieldBps: number | null;
  netYieldBps: number | null;
}

export interface AdvisorReportProperty {
  entityKey: `property:${string}`;
  usage: PropertyUsage;
  estimatedValueCents: number;
  purchaseYear: number | null;
  purchasePriceCents: number | null;
  linkedLoanBalanceCents: number;
  netEquityCents: number;
  ltvBps: number | null;
  rental?: AdvisorReportRentalDetails;
}

export interface AdvisorReportPotDeadline {
  status: PotDeadlineStatus;
  requiredMonthlyCents: number;
  requiredIsOneTime: boolean;
  shortfallAtDeadlineCents: number;
}

export interface AdvisorReportPot {
  entityKey: `pot:${string}`;
  purpose: "emergency_fund" | "goal" | "investment" | null;
  ruleType: PotRuleType;
  currentCents: number;
  targetCents: number | null;
  progressBps: number | null;
  targetMonth: string | null;
  deadline: AdvisorReportPotDeadline | null;
  linkedContractKey: `contract:${string}` | null;
  linkedPropertyKey: `property:${string}` | null;
  liquidityExclusion: "link_conflict" | "out_of_scope" | null;
}

export interface AdvisorReportCashflow {
  hasHouseholdData: boolean;
  totalInflowCents: number;
  totalOutflowCents: number;
  calibratedInflowCents: number;
  calibratedFixedOutflowCents: number;
  variableOutflowCents: number;
  manualInflowCents: number;
  manualOutflowCents: number;
  contractOutflowCents: number;
  propertyInflowCents: number;
  propertyOutflowCents: number;
  monthlySurplusCents: number;
  isDeficit: boolean;
  variableBasis: VariableExpenseBasis;
  isModeled: boolean;
}

export interface AdvisorReportHistoryRow {
  month: string;
  netWorthCents: number;
  freeAssetsCents: number;
  boundAssetsCents: number;
  liabilitiesCents: number;
  hasModeledValues: boolean;
}

export interface AdvisorReportHistory {
  rows: AdvisorReportHistoryRow[];
  anyModeled: boolean;
  netWorthDeltaCents: number | null;
}

export interface AdvisorReportRecommendations {
  monthly: RecommendationResult;
  oneTime: RecommendationResult | null;
  oneTimeInvalid: boolean;
}

export interface AdvisorReportEntityLabel {
  name: string;
  provider?: string | null;
  milestoneLabel?: string | null;
  loanOptionsNote?: string | null;
}

export interface AdvisorReport {
  meta: AdvisorReportMeta;
  profile: AdvisorReportProfile;
  balance: AdvisorReportBalance;
  contracts: AdvisorReportContract[];
  properties: AdvisorReportProperty[];
  pots: AdvisorReportPot[];
  cashflow: AdvisorReportCashflow;
  recommendations: AdvisorReportRecommendations;
  history: AdvisorReportHistory;
  dataQuality: {
    hints: AdvisorDataQualityHint[];
    snapshotAgeDays: number | null;
  };
  labels: Record<AdvisorEntityKey, AdvisorReportEntityLabel>;
}

export interface AdvisorReportOutlineItem {
  sectionId:
    | "profile"
    | "balance"
    | "history"
    | "contracts"
    | "properties"
    | "pots"
    | "cashflow"
    | "recommendations";
  label: string;
  count: number | null;
  isEmpty: boolean;
}
