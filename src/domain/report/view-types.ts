/** Anonymisierte Sicht auf den Berater-Bericht – nur sie verlässt das Gerät (Kopieren/Drucken). */
import type { AdvisorDataQualityHint, AdvisorReportMode } from "./types";
import type { VariableExpenseBasis } from "@/domain/allocation/cashflow";
import type { ContractCategory, RepaymentType } from "@/domain/contracts/contract";
import type { OptionRight, RateChangeScope, RateCorridor, SpecialRepaymentAllowance, SpecialRepaymentBasis } from "@/domain/contracts/loan-options";
import type { PotDeadlineStatus } from "@/domain/allocation/pot-deadline";
import type { PropertyUsage } from "@/domain/properties/properties";
import type { RecommendationItemKind } from "@/domain/recommendation/types";
import type { PotRuleType } from "@/domain/allocation/waterfall";

export interface AdvisorReportViewMeta {
  schemaVersion: number;
  mode: AdvisorReportMode;
  asOfDateDisplay: string;
  generatedDateDisplay: string;
  disclaimer: string;
}

export interface AdvisorReportViewProfile {
  propertyCount: number;
  ownerOccupiedCount: number;
  rentedCount: number;
  loanCount: number;
  savingsContractCount: number;
  potCount: number;
  hasHouseholdCashflow: boolean;
  emergencyCoverageMonthsTenths: number | null;
}

export interface AdvisorReportViewBalance {
  freeAssetsCents: number;
  conflictingLinkedPotsCents: number;
  outOfScopeLinkedPotsCents: number;
  propertiesValueCents: number;
  savingsContractsValueCents: number;
  boundAssetsCents: number;
  totalAssetsCents: number;
  liabilitiesCents: number;
  netWorthCents: number;
  freeShareBps: number;
  boundShareBps: number;
  liabilitiesShareBps: number;
  excludedPotsCents: number;
  isModeled: boolean;
}

export interface AdvisorReportViewLoanOptions {
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
    latestChangeDateDisplay: string | null;
    flags: RateCorridor["flags"];
  };
  hasNote: boolean;
  note: string | null;
}

export interface AdvisorReportViewContract {
  ref: string;
  displayName: string;
  provider: string | null;
  category: ContractCategory;
  status: "active" | "paused";
  projectedBalanceCents: number;
  isProjected: boolean;
  calibratedAsOfDisplay: string;
  calibrationStale: boolean;
  interestRateBps: number;
  monthlyRateCents: number;
  repaymentType: RepaymentType | null;
  fixedInterestUntilDisplay: string | null;
  futureLoanInterestRateBps: number | null;
  specialRepaymentMaxYearlyCents: number | null;
  loanOptions: AdvisorReportViewLoanOptions | null;
  targetSumCents: number | null;
  targetProgressBps: number | null;
  linkedPropertyRef: string | null;
  milestone: {
    dateDisplay: string;
    text: string;
  } | null;
}

export interface AdvisorReportViewRentalDetails {
  monthlyColdRentCents: number;
  monthlyNonRecoverableCostsCents: number;
  monthlyMaintenanceAllowanceCents: number;
  netCashflowBeforeReserveCents: number;
  grossYieldBps: number | null;
  netYieldBps: number | null;
}

export interface AdvisorReportViewProperty {
  ref: string;
  displayName: string;
  usage: PropertyUsage;
  estimatedValueCents: number;
  purchaseYear: number | null;
  purchasePriceCents: number | null;
  linkedLoanBalanceCents: number;
  netEquityCents: number;
  ltvBps: number | null;
  rental?: AdvisorReportViewRentalDetails;
}

export interface AdvisorReportViewPot {
  ref: string;
  displayName: string;
  purpose: "emergency_fund" | "goal" | "investment" | null;
  ruleType: PotRuleType;
  currentCents: number;
  targetCents: number | null;
  progressBps: number | null;
  targetMonthDisplay: string | null;
  deadline: {
    status: PotDeadlineStatus;
    requiredMonthlyCents: number;
    requiredIsOneTime: boolean;
    shortfallAtDeadlineCents: number;
  } | null;
  linkedContractRef: string | null;
  linkedPropertyRef: string | null;
  liquidityExclusion: "link_conflict" | "out_of_scope" | null;
}

export interface AdvisorReportViewCashflow {
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

export interface AdvisorReportViewRecommendationItem {
  ref: string;
  kind: RecommendationItemKind;
  amountCents: number;
  targetLabel: string;
  reasons: string[];
}

export interface AdvisorReportViewRecommendation {
  mode: "one_time" | "monthly";
  amountCents: number;
  headline: string;
  assumptionsSummary: string;
  loanOrder: string[];
  items: AdvisorReportViewRecommendationItem[];
  notes: string[];
}

export interface AdvisorReportViewHistoryRow {
  month: string;
  monthDisplay: string;
  netWorthCents: number;
  freeAssetsCents: number;
  boundAssetsCents: number;
  liabilitiesCents: number;
  hasModeledValues: boolean;
}

export interface AdvisorReportView {
  meta: AdvisorReportViewMeta;
  profile: AdvisorReportViewProfile;
  balance: AdvisorReportViewBalance;
  contracts: AdvisorReportViewContract[];
  properties: AdvisorReportViewProperty[];
  pots: AdvisorReportViewPot[];
  cashflow: AdvisorReportViewCashflow;
  recommendations: {
    monthly: AdvisorReportViewRecommendation;
    oneTime: AdvisorReportViewRecommendation | null;
    oneTimeInvalid: boolean;
  };
  history: {
    rows: AdvisorReportViewHistoryRow[];
    anyModeled: boolean;
    netWorthDeltaCents: number | null;
  };
  dataQuality: {
    hints: AdvisorDataQualityHint[];
    snapshotAgeDays: number | null;
  };
}
