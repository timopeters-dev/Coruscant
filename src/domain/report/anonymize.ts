import { formatMonthDE, formatMonthPartsDE } from "@/domain/core/date-format";
import type {
  AdvisorDataQualityHint,
  AdvisorEntityKey,
  AdvisorReport,
  AdvisorReportMode,
} from "./report";
import type { VariableExpenseBasis } from "@/domain/allocation/cashflow";
import type { ContractCategory, RepaymentType } from "@/domain/contracts/contract";
import { getTodayIsoDate, parseIsoDate } from "@/domain/core/date";
import type {
  OptionRight,
  RateChangeScope,
  RateCorridor,
  SpecialRepaymentAllowance,
  SpecialRepaymentBasis,
} from "@/domain/contracts/loan-options";
import {
  containsEmail,
  containsIban,
  containsLongDigitRun,
} from "@/domain/core/pii-patterns";
import type { PotDeadlineStatus } from "@/domain/allocation/pot-deadline";
import type { PropertyUsage } from "@/domain/properties/properties";
import type { RecommendationItemKind, RecommendationResult } from "@/domain/recommendation/types";
import {
  formatAssumptionsSummary,
  formatRecommendationHeadline,
  formatRecommendationNote,
  formatRecommendationReason,
  KIND_LABEL_DE,
  type RecommendationLabels,
  resolveItemLabel,
} from "@/domain/recommendation/text";
import type { PotRuleType } from "@/domain/allocation/waterfall";

export type AdvisorQuestionIssue = "iban" | "email" | "digit_run" | "known_name";

export interface AdvisorQuestionCheckResult {
  ok: boolean;
  issues: AdvisorQuestionIssue[];
}

export class AdvisorReportPiiError extends Error {
  readonly fieldPath: string;
  readonly reason: AdvisorQuestionIssue;

  constructor(fieldPath: string, reason: AdvisorQuestionIssue) {
    super(
      `PII detected in anonymized advisor report at "${fieldPath}" (${reason})`,
    );
    this.name = "AdvisorReportPiiError";
    this.fieldPath = fieldPath;
    this.reason = reason;
  }
}

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

export const GENERIC_FINANCE_TERMS: ReadonlySet<string> = new Set([
  "kredit",
  "kredite",
  "darlehen",
  "bauspar",
  "bausparer",
  "bausparvertrag",
  "annuität",
  "annuitaet",
  "tilgung",
  "endfällig",
  "sondertilgung",
  "tilgungsreserve",
  "wohnung",
  "haus",
  "topf",
  "töpfe",
  "ziel-topf",
  "notgroschen",
  "urlaub",
  "rücklage",
  "ruecklage",
  "immobilie",
  "immobilien",
  "konto",
  "sparen",
  "tagesgeld",
  "depot",
  "haushalt",
  "haushalts-app",
  "haushaltskonto",
  "geld",
  "zinsen",
  "zins",
  "rate",
  "sparrate",
  "miete",
  "kaltmiete",
  "vermietet",
  "eigengenutzt",
  "investition",
  "sparziel",
  "ohne zweck",
  "puffer",
  "reserve",
  "bank",
  "vertrag",
  "verträge",
  "guthaben",
  "schulden",
  "bilanz",
  "meilenstein",
  "etf",
]);

const VIEW_VOCABULARY_TERMS: ReadonlySet<string> = new Set([
  ...GENERIC_FINANCE_TERMS,
  ...Object.values(KIND_LABEL_DE).map((label) =>
    label.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase(),
  ),
]);

function formatIsoDateDE(isoDate: string): string {
  const { year, month, day } = parseIsoDate(isoDate, "isoDate");
  return `${String(day).padStart(2, "0")}.${formatMonthPartsDE(year, month)}`;
}

function formatIsoDateMonthYearSlash(isoDate: string): string {
  const { year, month } = parseIsoDate(isoDate, "isoDate");
  return formatMonthPartsDE(year, month);
}

function formatYearMonthSlash(ym: string): string {
  return formatMonthDE(ym);
}

function extractDateDisplayFromIsoTimestamp(timestamp: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(timestamp)) {
    return formatIsoDateDE(timestamp);
  }
  const parsed = new Date(timestamp);
  if (Number.isNaN(parsed.getTime())) {
    return "";
  }
  return formatIsoDateDE(getTodayIsoDate(parsed));
}

function contractTypeLabel(
  category: ContractCategory,
  repaymentType: RepaymentType | null,
): string {
  if (category === "savings_contract") {
    return "Bausparer";
  }
  switch (repaymentType) {
    case "annuity":
      return "Annuität";
    case "installment":
      return "Tilgung";
    case "lump_sum":
      return "Endfällig";
    default:
      return "Kredit";
  }
}

function propertyUsageLabel(usage: PropertyUsage): string {
  return usage === "rented" ? "vermietet" : "eigengenutzt";
}

function potPurposeLabel(
  purpose: "emergency_fund" | "goal" | "investment" | null,
): string {
  switch (purpose) {
    case "emergency_fund":
      return "Notgroschen";
    case "goal":
      return "Sparziel";
    case "investment":
      return "Investition";
    case null:
      return "ohne Zweck";
  }
}

function stripEntityPrefix(entityKey: AdvisorEntityKey): string {
  const idx = entityKey.indexOf(":");
  return idx >= 0 ? entityKey.slice(idx + 1) : entityKey;
}

function cloneDataQualityHint(
  hint: AdvisorDataQualityHint,
): AdvisorDataQualityHint {
  switch (hint.code) {
    case "NO_SNAPSHOT":
      return { code: "NO_SNAPSHOT" };
    case "SNAPSHOT_STALE":
      return { code: "SNAPSHOT_STALE", ageDays: hint.ageDays };
    case "DUMMY_HOUSEHOLD":
      return { code: "DUMMY_HOUSEHOLD" };
    case "NO_HOUSEHOLD_CASHFLOW":
      return { code: "NO_HOUSEHOLD_CASHFLOW" };
    case "PROJECTED_CONTRACTS":
      return { code: "PROJECTED_CONTRACTS", count: hint.count };
    case "STALE_CALIBRATION":
      return { code: "STALE_CALIBRATION", count: hint.count };
    case "EXCLUDED_POTS":
      return { code: "EXCLUDED_POTS", count: hint.count, cents: hint.cents };
    case "HISTORY_SPARSE":
      return { code: "HISTORY_SPARSE", monthCount: hint.monthCount };
    case "PROPERTY_VALUES_ESTIMATED":
      return { code: "PROPERTY_VALUES_ESTIMATED", count: hint.count };
  }
}

function buildRecommendationView(
  result: RecommendationResult,
  labels: RecommendationLabels,
  loanDisplayById: Map<string, string>,
): AdvisorReportViewRecommendation {
  const headline = formatRecommendationHeadline(result, labels);
  const assumptionsSummary = formatAssumptionsSummary(result.assumptions);
  const loanOrder = result.loanOrder.map(
    (loanId) => loanDisplayById.get(loanId) ?? "Kredit",
  );
  const items: AdvisorReportViewRecommendationItem[] = result.items.map(
    (item) => ({
      ref: item.ref,
      kind: item.kind,
      amountCents: item.amountCents,
      targetLabel: resolveItemLabel(item, labels),
      reasons: item.reasons.map((reason) => formatRecommendationReason(reason)),
    }),
  );
  const notes = result.notes.map((note) =>
    formatRecommendationNote(note, labels),
  );

  return {
    mode: result.mode,
    amountCents: result.amountCents,
    headline,
    assumptionsSummary,
    loanOrder,
    items,
    notes,
  };
}

export function buildAdvisorReportView(
  report: AdvisorReport,
  mode: AdvisorReportMode,
): AdvisorReportView {
  const refByEntityKey = new Map<AdvisorEntityKey, string>();

  let loanCounter = 0;
  let savingsCounter = 0;
  for (const contract of report.contracts) {
    if (contract.category === "loan") {
      loanCounter += 1;
      refByEntityKey.set(contract.entityKey, `KREDIT-${loanCounter}`);
    } else {
      savingsCounter += 1;
      refByEntityKey.set(contract.entityKey, `BAUSPAR-${savingsCounter}`);
    }
  }

  report.properties.forEach((property, index) => {
    refByEntityKey.set(property.entityKey, `IMMOBILIE-${index + 1}`);
  });

  report.pots.forEach((pot, index) => {
    refByEntityKey.set(pot.entityKey, `TOPF-${index + 1}`);
  });

  const recLabels: RecommendationLabels = {
    potNames: {},
    loanNames: {},
  };
  const loanDisplayById = new Map<string, string>();

  for (const contract of report.contracts) {
    const id = stripEntityPrefix(contract.entityKey);
    const ref = refByEntityKey.get(contract.entityKey)!;
    if (contract.category === "loan") {
      if (mode === "full") {
        const label = report.labels[contract.entityKey]?.name ?? ref;
        recLabels.loanNames[id] = label;
        loanDisplayById.set(id, `${label} (${ref})`);
      } else {
        recLabels.loanNames[id] = ref;
        loanDisplayById.set(id, ref);
      }
    }
  }

  for (const pot of report.pots) {
    const id = stripEntityPrefix(pot.entityKey);
    const ref = refByEntityKey.get(pot.entityKey)!;
    if (mode === "full") {
      recLabels.potNames[id] = report.labels[pot.entityKey]?.name ?? ref;
    } else {
      recLabels.potNames[id] = ref;
    }
  }

  const contracts: AdvisorReportViewContract[] = report.contracts.map(
    (contract) => {
      const ref = refByEntityKey.get(contract.entityKey)!;
      const sourceLabel = report.labels[contract.entityKey];
      const displayName =
        mode === "full"
          ? sourceLabel?.name ?? ref
          : `${ref} · ${contractTypeLabel(contract.category, contract.repaymentType)}`;

      const provider =
        mode === "full" ? (sourceLabel?.provider ?? null) : null;

      const calibratedAsOfDisplay =
        mode === "full"
          ? formatIsoDateDE(contract.calibratedAsOf)
          : formatIsoDateMonthYearSlash(contract.calibratedAsOf);

      const fixedInterestUntilDisplay =
        contract.fixedInterestUntil !== null
          ? mode === "full"
            ? formatIsoDateDE(contract.fixedInterestUntil)
            : formatIsoDateMonthYearSlash(contract.fixedInterestUntil)
          : null;

      let milestone: { dateDisplay: string; text: string } | null = null;
      if (contract.milestone !== null) {
        if (mode === "full") {
          const dateDisplay = formatIsoDateDE(contract.milestone.date);
          const trimmed = sourceLabel?.milestoneLabel?.trim() ?? "";
          milestone = {
            dateDisplay,
            text: trimmed.length > 0 ? trimmed : "Meilenstein",
          };
        } else {
          const dateDisplay = formatIsoDateMonthYearSlash(
            contract.milestone.date,
          );
          milestone = {
            dateDisplay,
            text: `Meilenstein ${dateDisplay}`,
          };
        }
      }

      const linkedPropertyRef =
        contract.linkedPropertyKey !== null
          ? (refByEntityKey.get(contract.linkedPropertyKey) ?? null)
          : null;

      const loanOptions: AdvisorReportViewLoanOptions | null =
        contract.loanOptions !== null
          ? {
              originalPrincipalCents:
                contract.loanOptions.originalPrincipalCents,
              specialRepayment: {
                status: contract.loanOptions.specialRepayment.status,
                basis: contract.loanOptions.specialRepayment.basis,
                percentBps: contract.loanOptions.specialRepayment.percentBps,
                capThisYearCents:
                  contract.loanOptions.specialRepayment.capThisYearCents,
                usedThisYearCents:
                  contract.loanOptions.specialRepayment.usedThisYearCents,
                remainingThisYearCents:
                  contract.loanOptions.specialRepayment.remainingThisYearCents,
                flags: {
                  capUnknown:
                    contract.loanOptions.specialRepayment.flags.capUnknown,
                  missingOriginalPrincipal:
                    contract.loanOptions.specialRepayment.flags
                      .missingOriginalPrincipal,
                  usageFromOtherYear:
                    contract.loanOptions.specialRepayment.flags
                      .usageFromOtherYear,
                },
              },
              rateChange: {
                status: contract.loanOptions.rateChange.status,
                totalCount: contract.loanOptions.rateChange.totalCount,
                usedCount: contract.loanOptions.rateChange.usedCount,
                remainingChanges:
                  contract.loanOptions.rateChange.remainingChanges,
                scope: contract.loanOptions.rateChange.scope,
                minRepaymentBps:
                  contract.loanOptions.rateChange.minRepaymentBps,
                maxRepaymentBps:
                  contract.loanOptions.rateChange.maxRepaymentBps,
                minMonthlyCents:
                  contract.loanOptions.rateChange.minMonthlyCents,
                maxMonthlyCents:
                  contract.loanOptions.rateChange.maxMonthlyCents,
                currentRepaymentBpsApprox:
                  contract.loanOptions.rateChange.currentRepaymentBpsApprox,
                latestChangeDateDisplay:
                  contract.loanOptions.rateChange.latestChangeDate !== null
                    ? mode === "full"
                      ? formatIsoDateDE(
                          contract.loanOptions.rateChange.latestChangeDate,
                        )
                      : formatIsoDateMonthYearSlash(
                          contract.loanOptions.rateChange.latestChangeDate,
                        )
                    : null,
                flags: {
                  corridorAssumed:
                    contract.loanOptions.rateChange.flags.corridorAssumed,
                  approximatedBase:
                    contract.loanOptions.rateChange.flags.approximatedBase,
                  currentOutsideCorridor:
                    contract.loanOptions.rateChange.flags
                      .currentOutsideCorridor,
                  minBelowInterest:
                    contract.loanOptions.rateChange.flags.minBelowInterest,
                  perYearUsageUntracked:
                    contract.loanOptions.rateChange.flags.perYearUsageUntracked,
                  exhausted: contract.loanOptions.rateChange.flags.exhausted,
                  corridorEmpty:
                    contract.loanOptions.rateChange.flags.corridorEmpty,
                },
              },
              hasNote: contract.loanOptions.hasNote,
              note:
                mode === "full"
                  ? (sourceLabel?.loanOptionsNote ?? null)
                  : null,
            }
          : null;

      return {
        ref,
        displayName,
        provider,
        category: contract.category,
        status: contract.status,
        projectedBalanceCents: contract.projectedBalanceCents,
        isProjected: contract.isProjected,
        calibratedAsOfDisplay,
        calibrationStale: contract.calibrationStale,
        interestRateBps: contract.interestRateBps,
        monthlyRateCents: contract.monthlyRateCents,
        repaymentType: contract.repaymentType,
        fixedInterestUntilDisplay,
        futureLoanInterestRateBps: contract.futureLoanInterestRateBps,
        specialRepaymentMaxYearlyCents: contract.specialRepaymentMaxYearlyCents,
        loanOptions,
        targetSumCents: contract.targetSumCents,
        targetProgressBps: contract.targetProgressBps,
        linkedPropertyRef,
        milestone,
      };
    },
  );

  const properties: AdvisorReportViewProperty[] = report.properties.map(
    (property) => {
      const ref = refByEntityKey.get(property.entityKey)!;
      const sourceLabel = report.labels[property.entityKey];
      const displayName =
        mode === "full"
          ? sourceLabel?.name ?? ref
          : `${ref} · ${propertyUsageLabel(property.usage)}`;

      const viewProperty: AdvisorReportViewProperty = {
        ref,
        displayName,
        usage: property.usage,
        estimatedValueCents: property.estimatedValueCents,
        purchaseYear: property.purchaseYear,
        purchasePriceCents: property.purchasePriceCents,
        linkedLoanBalanceCents: property.linkedLoanBalanceCents,
        netEquityCents: property.netEquityCents,
        ltvBps: property.ltvBps,
      };

      if (property.rental) {
        viewProperty.rental = {
          monthlyColdRentCents: property.rental.monthlyColdRentCents,
          monthlyNonRecoverableCostsCents:
            property.rental.monthlyNonRecoverableCostsCents,
          monthlyMaintenanceAllowanceCents:
            property.rental.monthlyMaintenanceAllowanceCents,
          netCashflowBeforeReserveCents:
            property.rental.netCashflowBeforeReserveCents,
          grossYieldBps: property.rental.grossYieldBps,
          netYieldBps: property.rental.netYieldBps,
        };
      }

      return viewProperty;
    },
  );

  const pots: AdvisorReportViewPot[] = report.pots.map((pot) => {
    const ref = refByEntityKey.get(pot.entityKey)!;
    const sourceLabel = report.labels[pot.entityKey];
    const displayName =
      mode === "full"
        ? sourceLabel?.name ?? ref
        : `${ref} · ${potPurposeLabel(pot.purpose)}`;

    const linkedContractRef =
      pot.linkedContractKey !== null
        ? (refByEntityKey.get(pot.linkedContractKey) ?? null)
        : null;
    const linkedPropertyRef =
      pot.linkedPropertyKey !== null
        ? (refByEntityKey.get(pot.linkedPropertyKey) ?? null)
        : null;

    return {
      ref,
      displayName,
      purpose: pot.purpose,
      ruleType: pot.ruleType,
      currentCents: pot.currentCents,
      targetCents: pot.targetCents,
      progressBps: pot.progressBps,
      targetMonthDisplay:
        pot.targetMonth !== null ? formatYearMonthSlash(pot.targetMonth) : null,
      deadline: pot.deadline
        ? {
            status: pot.deadline.status,
            requiredMonthlyCents: pot.deadline.requiredMonthlyCents,
            requiredIsOneTime: pot.deadline.requiredIsOneTime,
            shortfallAtDeadlineCents: pot.deadline.shortfallAtDeadlineCents,
          }
        : null,
      linkedContractRef,
      linkedPropertyRef,
      liquidityExclusion: pot.liquidityExclusion,
    };
  });

  const historyRows: AdvisorReportViewHistoryRow[] = report.history.rows.map(
    (row) => ({
      month: row.month,
      monthDisplay: formatYearMonthSlash(row.month),
      netWorthCents: row.netWorthCents,
      freeAssetsCents: row.freeAssetsCents,
      boundAssetsCents: row.boundAssetsCents,
      liabilitiesCents: row.liabilitiesCents,
      hasModeledValues: row.hasModeledValues,
    }),
  );

  return {
    meta: {
      schemaVersion: report.meta.schemaVersion,
      mode,
      asOfDateDisplay: formatIsoDateDE(report.meta.asOfDate),
      generatedDateDisplay: extractDateDisplayFromIsoTimestamp(
        report.meta.generatedAt,
      ),
      disclaimer: report.meta.disclaimer,
    },
    profile: {
      propertyCount: report.profile.propertyCount,
      ownerOccupiedCount: report.profile.ownerOccupiedCount,
      rentedCount: report.profile.rentedCount,
      loanCount: report.profile.loanCount,
      savingsContractCount: report.profile.savingsContractCount,
      potCount: report.profile.potCount,
      hasHouseholdCashflow: report.profile.hasHouseholdCashflow,
      emergencyCoverageMonthsTenths:
        report.profile.emergencyCoverageMonthsTenths,
    },
    balance: {
      freeAssetsCents: report.balance.freeAssetsCents,
      conflictingLinkedPotsCents: report.balance.conflictingLinkedPotsCents,
      outOfScopeLinkedPotsCents: report.balance.outOfScopeLinkedPotsCents,
      propertiesValueCents: report.balance.propertiesValueCents,
      savingsContractsValueCents: report.balance.savingsContractsValueCents,
      boundAssetsCents: report.balance.boundAssetsCents,
      totalAssetsCents: report.balance.totalAssetsCents,
      liabilitiesCents: report.balance.liabilitiesCents,
      netWorthCents: report.balance.netWorthCents,
      freeShareBps: report.balance.freeShareBps,
      boundShareBps: report.balance.boundShareBps,
      liabilitiesShareBps: report.balance.liabilitiesShareBps,
      excludedPotsCents: report.balance.excludedPotsCents,
      isModeled: report.balance.isModeled,
    },
    contracts,
    properties,
    pots,
    cashflow: {
      hasHouseholdData: report.cashflow.hasHouseholdData,
      totalInflowCents: report.cashflow.totalInflowCents,
      totalOutflowCents: report.cashflow.totalOutflowCents,
      calibratedInflowCents: report.cashflow.calibratedInflowCents,
      calibratedFixedOutflowCents: report.cashflow.calibratedFixedOutflowCents,
      variableOutflowCents: report.cashflow.variableOutflowCents,
      manualInflowCents: report.cashflow.manualInflowCents,
      manualOutflowCents: report.cashflow.manualOutflowCents,
      contractOutflowCents: report.cashflow.contractOutflowCents,
      propertyInflowCents: report.cashflow.propertyInflowCents,
      propertyOutflowCents: report.cashflow.propertyOutflowCents,
      monthlySurplusCents: report.cashflow.monthlySurplusCents,
      isDeficit: report.cashflow.isDeficit,
      variableBasis: report.cashflow.variableBasis,
      isModeled: report.cashflow.isModeled,
    },
    recommendations: {
      monthly: buildRecommendationView(
        report.recommendations.monthly,
        recLabels,
        loanDisplayById,
      ),
      oneTime: report.recommendations.oneTime
        ? buildRecommendationView(
            report.recommendations.oneTime,
            recLabels,
            loanDisplayById,
          )
        : null,
      oneTimeInvalid: report.recommendations.oneTimeInvalid,
    },
    history: {
      rows: historyRows,
      anyModeled: report.history.anyModeled,
      netWorthDeltaCents: report.history.netWorthDeltaCents,
    },
    dataQuality: {
      hints: report.dataQuality.hints.map(cloneDataQualityHint),
      snapshotAgeDays: report.dataQuality.snapshotAgeDays,
    },
  };
}

function normalizeSensitive(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
}

export function collectSensitiveStrings(report: AdvisorReport): string[] {
  const unique = new Set<string>();
  for (const label of Object.values(report.labels)) {
    for (const candidate of [
      label.name,
      label.provider,
      label.milestoneLabel,
      label.loanOptionsNote,
    ]) {
      if (typeof candidate !== "string") continue;
      const normalized = normalizeSensitive(candidate);
      if (normalized.length >= 3) {
        unique.add(normalized);
      }
    }
  }
  return Array.from(unique).sort();
}

function walkStrings(
  value: unknown,
  path: string,
  visit: (str: string, fieldPath: string) => void,
): void {
  if (typeof value === "string") {
    visit(value, path);
    return;
  }
  if (value === null || value === undefined || typeof value !== "object") {
    return;
  }
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) {
      walkStrings(value[i], `${path}[${i}]`, visit);
    }
    return;
  }
  for (const [key, nested] of Object.entries(value)) {
    const nextPath = path.length > 0 ? `${path}.${key}` : key;
    walkStrings(nested, nextPath, visit);
  }
}

export function assertAnonymizedViewClean(
  view: AdvisorReportView,
  sensitive: readonly string[],
): void {
  const matchers = sensitive
    .map((s) => normalizeSensitive(s))
    .filter((s) => s.length >= 3 && !VIEW_VOCABULARY_TERMS.has(s))
    .map(
      (term) =>
        new RegExp(
          `(?<![\\p{L}\\p{N}])${escapeRegExp(term)}(?![\\p{L}\\p{N}])`,
          "u",
        ),
    );

  walkStrings(view, "", (str, fieldPath) => {
    if (containsIban(str)) {
      throw new AdvisorReportPiiError(fieldPath, "iban");
    }
    if (containsEmail(str)) {
      throw new AdvisorReportPiiError(fieldPath, "email");
    }
    if (containsLongDigitRun(str, 8)) {
      throw new AdvisorReportPiiError(fieldPath, "digit_run");
    }
    const normalizedStr = normalizeSensitive(str);
    for (const pattern of matchers) {
      if (pattern.test(normalizedStr)) {
        throw new AdvisorReportPiiError(fieldPath, "known_name");
      }
    }
  });
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extractQuestionMatchTerms(sensitive: readonly string[]): string[] {
  const terms = new Set<string>();
  for (const raw of sensitive) {
    const normalized = normalizeSensitive(raw);
    if (normalized.length >= 3 && !/^\d+$/.test(normalized) && !GENERIC_FINANCE_TERMS.has(normalized)) {
      terms.add(normalized);
    }
    const words = normalized.match(/[\p{L}\p{N}]+/gu) ?? [];
    for (const word of words) {
      if (word.length < 4) continue;
      if (/^\d+$/.test(word)) continue;
      if (GENERIC_FINANCE_TERMS.has(word)) continue;
      terms.add(word);
    }
  }
  return Array.from(terms);
}

export function checkAdvisorQuestion(
  text: string,
  sensitive: readonly string[],
): AdvisorQuestionCheckResult {
  const normalized = text.normalize("NFKC").trim();
  if (normalized.length === 0) {
    return { ok: true, issues: [] };
  }

  const issues: AdvisorQuestionIssue[] = [];
  if (containsIban(normalized)) {
    issues.push("iban");
  }
  if (containsEmail(normalized)) {
    issues.push("email");
  }
  if (containsLongDigitRun(normalized, 8)) {
    issues.push("digit_run");
  }

  const lowerText = normalized.replace(/\s+/g, " ").toLowerCase();
  const terms = extractQuestionMatchTerms(sensitive);
  for (const term of terms) {
    const pattern = new RegExp(
      `(?<![\\p{L}\\p{N}])${escapeRegExp(term)}(?![\\p{L}\\p{N}])`,
      "u",
    );
    if (pattern.test(lowerText)) {
      issues.push("known_name");
      break;
    }
  }

  return {
    ok: issues.length === 0,
    issues,
  };
}
