import {
  type BalanceSummary,
  calculateBalanceBarBreakdown,
} from "@/domain/cockpit/balance";
import {
  type BalanceHistoryPoint,
  selectMonthEndValues,
} from "@/domain/cockpit/balance-history";
import type {
  ConsolidatedCashflowSummary,
  VariableExpenseBasis,
} from "@/domain/allocation/cashflow";
import {
  type ContractCategory,
  getCalibrationAge,
  projectContractBalance,
  type RepaymentType,
} from "@/domain/contracts/contract";
import {
  diffCalendarDays,
  getTodayIsoDate,
  parseIsoDate,
  toYearMonth,
} from "@/domain/core/date";
import {
  getLoanOptions,
  type OptionRight,
  type RateChangeScope,
  type RateCorridor,
  remainingSpecialRepaymentCents,
  repaymentBpsFromRate,
  resolveRateCorridor,
  type SpecialRepaymentAllowance,
  type SpecialRepaymentBasis,
} from "@/domain/contracts/loan-options";
import {
  assertNonNegativeInteger,
  assertSafeInteger,
  parseEuroInputToCents,
  roundHalfUpBigInt,
} from "@/domain/core/money";
import {
  evaluatePotDeadlines,
  type PotDeadlineStatus,
} from "@/domain/allocation/pot-deadline";
import {
  type DomainLinkedContract,
  type DomainPropertyDetail,
  type PropertyUsage,
  summarizeProperties,
} from "@/domain/properties/properties";
import { DEFAULT_RECOMMENDATION_ASSUMPTIONS, type RecommendationPot, type RecommendationResult, type RecommendationState } from "@/domain/recommendation/types";
import { recommendMonthlySavings, recommendUse } from "@/domain/recommendation/recommendation";
import {
  type DomainRentalProfile,
  type DomainRentalProperty,
  summarizeRentalPortfolio,
} from "@/domain/properties/rental";
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

function compareStrings(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function extractCalendarDateFromTimestamp(timestamp: string): string | null {
  if (/^\d{4}-\d{2}-\d{2}$/.test(timestamp)) {
    parseIsoDate(timestamp, "snapshotFetchedAt");
    return timestamp;
  }
  const parsed = new Date(timestamp);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return getTodayIsoDate(parsed);
}

export function parseAdvisorOneTimeAmount(
  raw: string | undefined,
): { cents: number | null; invalid: boolean } {
  if (raw === undefined || raw.trim().length === 0) {
    return { cents: null, invalid: false };
  }
  const parsed = parseEuroInputToCents(raw);
  if (
    parsed === null ||
    parsed < ADVISOR_MIN_ONE_TIME_CENTS ||
    parsed > ADVISOR_MAX_ONE_TIME_CENTS
  ) {
    return { cents: null, invalid: true };
  }
  return { cents: parsed, invalid: false };
}

export function parseAdvisorReportMode(
  raw: string | undefined,
): AdvisorReportMode {
  return raw === "vollstaendig" ? "full" : "anonymized";
}

export function buildAdvisorReport(input: AdvisorReportInput): AdvisorReport {
  parseIsoDate(input.asOfDate, "asOfDate");

  assertNonNegativeInteger(input.balance.freeAssetsCents, "balance.freeAssetsCents");
  assertNonNegativeInteger(
    input.balance.conflictingLinkedPotsCents,
    "balance.conflictingLinkedPotsCents",
  );
  assertNonNegativeInteger(
    input.balance.outOfScopeLinkedPotsCents,
    "balance.outOfScopeLinkedPotsCents",
  );
  assertNonNegativeInteger(
    input.balance.propertiesValueCents,
    "balance.propertiesValueCents",
  );
  assertNonNegativeInteger(
    input.balance.savingsContractsValueCents,
    "balance.savingsContractsValueCents",
  );
  assertNonNegativeInteger(
    input.balance.boundAssetsCents,
    "balance.boundAssetsCents",
  );
  assertNonNegativeInteger(
    input.balance.totalAssetsCents,
    "balance.totalAssetsCents",
  );
  assertNonNegativeInteger(
    input.balance.liabilitiesCents,
    "balance.liabilitiesCents",
  );
  assertSafeInteger(input.balance.netWorthCents, "balance.netWorthCents");

  const labels: Record<AdvisorEntityKey, AdvisorReportEntityLabel> = {};
  const propertyIds = new Set(input.properties.map((p) => p.id));

  // 1. Contracts (non-closed, sorted: loan first, projectedBalanceCents DESC, id ASC)
  const nonClosedContracts = input.contracts.filter(
    (c) => c.status !== "closed",
  );
  const nonClosedContractIds = new Set(nonClosedContracts.map((c) => c.id));

  let projectedContractsCount = 0;
  let staleCalibrationCount = 0;

  const contractEntries = nonClosedContracts.map((contract) => {
    const projection = projectContractBalance(contract, input.asOfDate);
    const calibration = getCalibrationAge(contract, input.asOfDate);
    if (projection.isProjected) {
      projectedContractsCount += 1;
    }
    if (calibration.isStale) {
      staleCalibrationCount += 1;
    }

    if (contract.milestoneDate != null) {
      parseIsoDate(contract.milestoneDate, "milestoneDate");
    }
    if (contract.fixedInterestUntil != null) {
      parseIsoDate(contract.fixedInterestUntil, "fixedInterestUntil");
    }
    if (contract.futureLoanInterestRateBps != null) {
      assertNonNegativeInteger(
        contract.futureLoanInterestRateBps,
        "futureLoanInterestRateBps",
      );
    }

    const opts = contract.category === "loan" ? getLoanOptions(contract) : null;
    const trimmedNote = opts?.loanOptionsNote?.trim() ?? "";

    const entityKey: `contract:${string}` = `contract:${contract.id}`;
    labels[entityKey] = {
      name: contract.name,
      provider: contract.provider ?? null,
      milestoneLabel: contract.milestoneLabel ?? null,
      loanOptionsNote: trimmedNote.length > 0 ? trimmedNote : null,
    };

    let loanOptions: AdvisorReportLoanOptions | null = null;
    let resolvedCapCents: number | null = null;
    if (contract.category === "loan" && opts !== null) {
      const allowance = remainingSpecialRepaymentCents(
        contract,
        input.asOfDate,
      );
      const corridor = resolveRateCorridor(contract, input.asOfDate);
      const currentRepaymentBpsApprox =
        repaymentBpsFromRate(contract, contract.monthlyRateCents)?.bps ?? null;
      resolvedCapCents = allowance.capCents;
      loanOptions = {
        originalPrincipalCents: opts.originalPrincipalCents,
        specialRepayment: {
          status: allowance.status,
          basis: allowance.basis,
          percentBps: allowance.percentBps,
          capThisYearCents: allowance.capCents,
          usedThisYearCents: allowance.usedCents,
          remainingThisYearCents: allowance.remainingCents,
          flags: { ...allowance.flags },
        },
        rateChange: {
          status: corridor.status,
          totalCount: opts.rateChangeTotalCount,
          usedCount: opts.rateChangeUsedCount,
          remainingChanges: corridor.remainingChanges,
          scope: opts.rateChangeScope,
          minRepaymentBps: corridor.minRepaymentBps,
          maxRepaymentBps: corridor.maxRepaymentBps,
          minMonthlyCents: corridor.minMonthlyCents,
          maxMonthlyCents: corridor.maxMonthlyCents,
          currentRepaymentBpsApprox,
          latestChangeDate: corridor.latestChangeDate,
          flags: { ...corridor.flags },
        },
        hasNote: trimmedNote.length > 0,
      };
    }

    const item: AdvisorReportContract = {
      entityKey,
      category: contract.category,
      status: contract.status === "paused" ? "paused" : "active",
      projectedBalanceCents: projection.projectedBalanceCents,
      isProjected: projection.isProjected,
      calibratedAsOf: contract.balanceAsOfDate,
      calibrationStale: calibration.isStale,
      interestRateBps: contract.interestRateBps,
      monthlyRateCents: contract.monthlyRateCents,
      repaymentType: contract.repaymentType ?? null,
      fixedInterestUntil: contract.fixedInterestUntil ?? null,
      futureLoanInterestRateBps: contract.futureLoanInterestRateBps ?? null,
      specialRepaymentMaxYearlyCents: resolvedCapCents,
      loanOptions,
      targetSumCents: contract.targetSumCents ?? null,
      targetProgressBps: projection.targetProgressBps,
      linkedPropertyKey:
        contract.linkedPropertyId && propertyIds.has(contract.linkedPropertyId)
          ? `property:${contract.linkedPropertyId}`
          : null,
      milestone:
        contract.milestoneDate != null
          ? {
              date: contract.milestoneDate,
              hasLabel: Boolean(contract.milestoneLabel?.trim()),
            }
          : null,
    };

    return { id: contract.id, item };
  });

  contractEntries.sort((a, b) => {
    const rankA = a.item.category === "loan" ? 0 : 1;
    const rankB = b.item.category === "loan" ? 0 : 1;
    if (rankA !== rankB) return rankA - rankB;
    if (a.item.projectedBalanceCents !== b.item.projectedBalanceCents) {
      return b.item.projectedBalanceCents - a.item.projectedBalanceCents;
    }
    return compareStrings(a.id, b.id);
  });
  const contracts = contractEntries.map((entry) => entry.item);

  // 2. Properties (sorted: estimatedValueCents DESC, id ASC)
  const propertySummaries = summarizeProperties(
    input.properties,
    input.contracts,
    input.asOfDate,
  );
  const rentalProperties: DomainRentalProperty[] = input.properties.map((p) => ({
    ...p,
    monthlyColdRentCents: p.monthlyColdRentCents ?? null,
    monthlyNonRecoverableCostsCents: p.monthlyNonRecoverableCostsCents ?? null,
    monthlyMaintenanceAllowanceCents: p.monthlyMaintenanceAllowanceCents ?? null,
    depreciationBasisCents: p.depreciationBasisCents ?? null,
  }));
  const rentalSummary = summarizeRentalPortfolio(
    rentalProperties,
    input.contracts,
    input.asOfDate,
  );
  const rentalByPropertyId = new Map(
    rentalSummary.items.map((item) => [item.propertyId, item]),
  );

  const propertyEntries = input.properties.map((property) => {
    const summary = propertySummaries[property.id]!;
    const entityKey: `property:${string}` = `property:${property.id}`;
    labels[entityKey] = {
      name: property.name,
    };

    const rentalMetrics =
      property.usage === "rented"
        ? rentalByPropertyId.get(property.id)
        : undefined;

    const item: AdvisorReportProperty = {
      entityKey,
      usage: property.usage,
      estimatedValueCents: summary.estimatedValueCents,
      purchaseYear: property.purchaseDate
        ? parseIsoDate(property.purchaseDate, "purchaseDate").year
        : null,
      purchasePriceCents: property.purchasePriceCents ?? null,
      linkedLoanBalanceCents: summary.linkedLoanBalanceCents,
      netEquityCents: summary.netEquityCents,
      ltvBps: summary.ltvBps,
      ...(rentalMetrics
        ? {
            rental: {
              monthlyColdRentCents: rentalMetrics.monthlyColdRentCents,
              monthlyNonRecoverableCostsCents:
                rentalMetrics.monthlyNonRecoverableCostsCents,
              monthlyMaintenanceAllowanceCents:
                rentalMetrics.monthlyMaintenanceAllowanceCents,
              netCashflowBeforeReserveCents:
                rentalMetrics.netCashflowBeforeReserveCents,
              grossYieldBps: rentalMetrics.grossYieldBps,
              netYieldBps: rentalMetrics.netYieldBps,
            },
          }
        : {}),
    };

    return { id: property.id, item };
  });

  propertyEntries.sort((a, b) => {
    if (a.item.estimatedValueCents !== b.item.estimatedValueCents) {
      return b.item.estimatedValueCents - a.item.estimatedValueCents;
    }
    return compareStrings(a.id, b.id);
  });
  const properties = propertyEntries.map((entry) => entry.item);

  // 3. Pots (sorted: priority ASC, id ASC)
  const sortedInputPots = [...input.pots].sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority;
    return compareStrings(a.id, b.id);
  });

  for (const pot of sortedInputPots) {
    assertNonNegativeInteger(pot.currentCents, `pot(${pot.id}).currentCents`);
    if (pot.targetCents !== null) {
      assertNonNegativeInteger(pot.targetCents, `pot(${pot.id}).targetCents`);
    }
  }

  const deadlineEvals = evaluatePotDeadlines({
    pots: sortedInputPots,
    monthlySurplusCents: input.cashflow.monthlySurplusCents,
    todayIsoDate: input.asOfDate,
  });
  const deadlineByPotId = new Map(deadlineEvals.map((d) => [d.potId, d]));

  let excludedPotsCount = 0;
  let excludedPotsCentsFromPots = 0;
  let emergencyFundCents = 0;

  const pots: AdvisorReportPot[] = sortedInputPots.map((pot) => {
    const entityKey: `pot:${string}` = `pot:${pot.id}`;
    labels[entityKey] = {
      name: pot.name,
    };

    if (pot.liquidityExclusion !== null) {
      excludedPotsCount += 1;
      excludedPotsCentsFromPots = assertSafeInteger(
        excludedPotsCentsFromPots + pot.currentCents,
        "excludedPotsCents",
      );
    }
    if (pot.purpose === "emergency_fund") {
      emergencyFundCents = assertSafeInteger(
        emergencyFundCents + pot.currentCents,
        "emergencyFundCents",
      );
    }

    let progressBps: number | null = null;
    if (pot.targetCents !== null && pot.targetCents > 0) {
      progressBps = assertSafeInteger(
        Number(
          roundHalfUpBigInt(
            BigInt(pot.currentCents) * 10_000n,
            BigInt(pot.targetCents),
          ),
        ),
        "progressBps",
      );
    }

    const deadlineEval = deadlineByPotId.get(pot.id);

    return {
      entityKey,
      purpose: pot.purpose,
      ruleType: pot.ruleType,
      currentCents: pot.currentCents,
      targetCents: pot.targetCents,
      progressBps,
      targetMonth: pot.targetDate ? toYearMonth(pot.targetDate) : null,
      deadline: deadlineEval
        ? {
            status: deadlineEval.status,
            requiredMonthlyCents: deadlineEval.requiredMonthlyCents,
            requiredIsOneTime: deadlineEval.requiredIsOneTime,
            shortfallAtDeadlineCents: deadlineEval.shortfallAtDeadlineCents,
          }
        : null,
      linkedContractKey:
        pot.linkedContractId && nonClosedContractIds.has(pot.linkedContractId)
          ? `contract:${pot.linkedContractId}`
          : null,
      linkedPropertyKey:
        pot.linkedPropertyId && propertyIds.has(pot.linkedPropertyId)
          ? `property:${pot.linkedPropertyId}`
          : null,
      liquidityExclusion: pot.liquidityExclusion,
    };
  });

  // 4. Balance
  const bar = calculateBalanceBarBreakdown(input.balance);
  const excludedPotsCents = assertNonNegativeInteger(
    input.balance.conflictingLinkedPotsCents +
      input.balance.outOfScopeLinkedPotsCents,
    "excludedPotsCents",
  );
  const balance: AdvisorReportBalance = {
    asOfDate: input.balance.asOfDate,
    freeAssetsCents: input.balance.freeAssetsCents,
    conflictingLinkedPotsCents: input.balance.conflictingLinkedPotsCents,
    outOfScopeLinkedPotsCents: input.balance.outOfScopeLinkedPotsCents,
    propertiesValueCents: input.balance.propertiesValueCents,
    savingsContractsValueCents: input.balance.savingsContractsValueCents,
    boundAssetsCents: input.balance.boundAssetsCents,
    totalAssetsCents: input.balance.totalAssetsCents,
    liabilitiesCents: input.balance.liabilitiesCents,
    netWorthCents: input.balance.netWorthCents,
    freeShareBps: bar.freeShareBps,
    boundShareBps: bar.boundShareBps,
    liabilitiesShareBps: bar.liabilitiesShareBps,
    excludedPotsCents,
    isModeled: properties.length > 0 || projectedContractsCount > 0,
  };

  // 5. Cashflow
  const cashflow: AdvisorReportCashflow = {
    hasHouseholdData: input.cashflow.hasHouseholdData,
    totalInflowCents: assertNonNegativeInteger(
      input.cashflow.totalInflowCents,
      "cashflow.totalInflowCents",
    ),
    totalOutflowCents: assertNonNegativeInteger(
      input.cashflow.totalOutflowCents,
      "cashflow.totalOutflowCents",
    ),
    calibratedInflowCents: assertNonNegativeInteger(
      input.cashflow.calibratedInflowCents,
      "cashflow.calibratedInflowCents",
    ),
    calibratedFixedOutflowCents: assertNonNegativeInteger(
      input.cashflow.calibratedFixedOutflowCents,
      "cashflow.calibratedFixedOutflowCents",
    ),
    variableOutflowCents: assertNonNegativeInteger(
      input.cashflow.variableOutflowCents,
      "cashflow.variableOutflowCents",
    ),
    manualInflowCents: assertNonNegativeInteger(
      input.cashflow.manualInflowCents,
      "cashflow.manualInflowCents",
    ),
    manualOutflowCents: assertNonNegativeInteger(
      input.cashflow.manualOutflowCents,
      "cashflow.manualOutflowCents",
    ),
    contractOutflowCents: assertNonNegativeInteger(
      input.cashflow.contractOutflowCents,
      "cashflow.contractOutflowCents",
    ),
    propertyInflowCents: assertNonNegativeInteger(
      input.cashflow.propertyInflowCents,
      "cashflow.propertyInflowCents",
    ),
    propertyOutflowCents: assertNonNegativeInteger(
      input.cashflow.propertyOutflowCents,
      "cashflow.propertyOutflowCents",
    ),
    monthlySurplusCents: assertSafeInteger(
      input.cashflow.monthlySurplusCents,
      "cashflow.monthlySurplusCents",
    ),
    isDeficit: input.cashflow.isDeficit,
    variableBasis: input.cashflow.selectedVariableBasis,
    isModeled: input.isDummyHousehold || !input.cashflow.hasHouseholdData,
  };

  // 6. Profile
  const ownerOccupiedCount = properties.filter(
    (p) => p.usage === "owner_occupied",
  ).length;
  const rentedCount = properties.filter((p) => p.usage === "rented").length;
  const loanCount = contracts.filter((c) => c.category === "loan").length;
  const savingsContractCount = contracts.filter(
    (c) => c.category === "savings_contract",
  ).length;

  const emergencyCoverageMonthsTenths =
    cashflow.totalOutflowCents > 0
      ? assertSafeInteger(
          Number(
            roundHalfUpBigInt(
              BigInt(emergencyFundCents) * 10n,
              BigInt(cashflow.totalOutflowCents),
            ),
          ),
          "emergencyCoverageMonthsTenths",
        )
      : null;

  const profile: AdvisorReportProfile = {
    propertyCount: properties.length,
    ownerOccupiedCount,
    rentedCount,
    loanCount,
    savingsContractCount,
    potCount: pots.length,
    hasHouseholdCashflow: cashflow.hasHouseholdData,
    emergencyCoverageMonthsTenths,
  };

  // 7. Recommendations
  const monthly = recommendMonthlySavings(
    input.recommendationState,
    DEFAULT_RECOMMENDATION_ASSUMPTIONS,
  );
  let oneTime: RecommendationResult | null = null;
  let oneTimeInvalid = false;
  if (input.oneTimeAmountCents !== null) {
    if (
      !Number.isSafeInteger(input.oneTimeAmountCents) ||
      input.oneTimeAmountCents < ADVISOR_MIN_ONE_TIME_CENTS ||
      input.oneTimeAmountCents > ADVISOR_MAX_ONE_TIME_CENTS
    ) {
      oneTimeInvalid = true;
    } else {
      oneTime = recommendUse(
        input.oneTimeAmountCents,
        input.recommendationState,
        DEFAULT_RECOMMENDATION_ASSUMPTIONS,
      );
    }
  }

  // 8. History (last 12 month-end values, ascending)
  const monthEndDesc = selectMonthEndValues(
    input.history,
    ADVISOR_HISTORY_MONTHS,
  );
  const historyRows: AdvisorReportHistoryRow[] = [...monthEndDesc]
    .reverse()
    .map(({ month, point }) => ({
      month,
      netWorthCents: point.netWorthCents,
      freeAssetsCents: point.freeAssetsCents,
      boundAssetsCents: point.boundAssetsCents,
      liabilitiesCents: point.liabilitiesCents,
      hasModeledValues: point.hasModeledValues,
    }));

  const anyModeled = historyRows.some((row) => row.hasModeledValues);
  const netWorthDeltaCents =
    historyRows.length >= 2
      ? assertSafeInteger(
          historyRows[historyRows.length - 1]!.netWorthCents -
            historyRows[0]!.netWorthCents,
          "netWorthDeltaCents",
        )
      : null;

  const history: AdvisorReportHistory = {
    rows: historyRows,
    anyModeled,
    netWorthDeltaCents,
  };

  // 9. Data quality hints (fixed order)
  let snapshotAgeDays: number | null = null;
  if (input.snapshotFetchedAt !== null) {
    const fetchedIsoDate = extractCalendarDateFromTimestamp(
      input.snapshotFetchedAt,
    );
    if (fetchedIsoDate !== null) {
      snapshotAgeDays = diffCalendarDays(fetchedIsoDate, input.asOfDate);
    }
  }

  const hints: AdvisorDataQualityHint[] = [];
  if (input.snapshotFetchedAt === null) {
    hints.push({ code: "NO_SNAPSHOT" });
  } else if (
    snapshotAgeDays !== null &&
    snapshotAgeDays > ADVISOR_STALE_SNAPSHOT_DAYS
  ) {
    hints.push({ code: "SNAPSHOT_STALE", ageDays: snapshotAgeDays });
  }
  if (input.isDummyHousehold) {
    hints.push({ code: "DUMMY_HOUSEHOLD" });
  }
  if (!cashflow.hasHouseholdData) {
    hints.push({ code: "NO_HOUSEHOLD_CASHFLOW" });
  }
  if (projectedContractsCount > 0) {
    hints.push({ code: "PROJECTED_CONTRACTS", count: projectedContractsCount });
  }
  if (staleCalibrationCount > 0) {
    hints.push({ code: "STALE_CALIBRATION", count: staleCalibrationCount });
  }
  if (excludedPotsCount > 0) {
    hints.push({
      code: "EXCLUDED_POTS",
      count: excludedPotsCount,
      cents: excludedPotsCentsFromPots,
    });
  }
  if (historyRows.length < 2) {
    hints.push({ code: "HISTORY_SPARSE", monthCount: historyRows.length });
  }
  if (properties.length > 0) {
    hints.push({
      code: "PROPERTY_VALUES_ESTIMATED",
      count: properties.length,
    });
  }

  return {
    meta: {
      schemaVersion: ADVISOR_REPORT_SCHEMA_VERSION,
      asOfDate: input.asOfDate,
      generatedAt: input.generatedAt,
      disclaimer: ADVISOR_DISCLAIMER,
    },
    profile,
    balance,
    contracts,
    properties,
    pots,
    cashflow,
    recommendations: {
      monthly,
      oneTime,
      oneTimeInvalid,
    },
    history,
    dataQuality: {
      hints,
      snapshotAgeDays,
    },
    labels,
  };
}

export function buildAdvisorReportOutline(
  report: AdvisorReport,
): AdvisorReportOutlineItem[] {
  const recommendationCount =
    report.recommendations.monthly.items.length +
    (report.recommendations.oneTime?.items.length ?? 0);

  return [
    {
      sectionId: "profile",
      label: "Kurzprofil",
      count: null,
      isEmpty: false,
    },
    {
      sectionId: "balance",
      label: "Bilanz",
      count: null,
      isEmpty:
        report.balance.totalAssetsCents === 0 &&
        report.balance.liabilitiesCents === 0,
    },
    {
      sectionId: "history",
      label: "Verlauf",
      count: report.history.rows.length,
      isEmpty: report.history.rows.length === 0,
    },
    {
      sectionId: "contracts",
      label: "Verträge & Kredite",
      count: report.contracts.length,
      isEmpty: report.contracts.length === 0,
    },
    {
      sectionId: "properties",
      label: "Immobilien",
      count: report.properties.length,
      isEmpty: report.properties.length === 0,
    },
    {
      sectionId: "pots",
      label: "Töpfe & Ziele",
      count: report.pots.length,
      isEmpty: report.pots.length === 0,
    },
    {
      sectionId: "cashflow",
      label: "Cashflow",
      count: null,
      isEmpty:
        !report.cashflow.hasHouseholdData &&
        report.cashflow.totalInflowCents === 0 &&
        report.cashflow.totalOutflowCents === 0,
    },
    {
      sectionId: "recommendations",
      label: "Empfehlungen",
      count: recommendationCount,
      isEmpty: recommendationCount === 0,
    },
  ];
}
