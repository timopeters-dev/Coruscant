import { listPots } from "./pots";
import { listBalanceSnapshots } from "./balance-history";
import { loadHouseholdBalance } from "./cockpit";
import { listContracts } from "./contracts";
import { listProperties } from "./properties";
import { loadPlanningBase } from "./planning-base";
import { loadRecommendationState } from "./recommendation";
import type {
  AdvisorReport, AdvisorReportMode, AdvisorReportOutlineItem,
} from "@/domain/report/types";
import { buildAdvisorReport, parseAdvisorOneTimeAmount } from "@/domain/report/report";
import { buildAdvisorReportOutline } from "@/domain/report/outline";
import type { AdvisorReportView } from "@/domain/report/view-types";
import { assertAnonymizedViewClean, collectSensitiveStrings } from "@/domain/report/pii-check";
import { buildAdvisorReportView } from "@/domain/report/anonymize";
import { getTodayIsoDate } from "@/domain/core/date";

export interface LoadAdvisorReportOptions {
  mode: AdvisorReportMode;
  oneTimeRaw?: string;
  asOfDate?: string;
  now?: Date;
}

export interface LoadAdvisorReportResult {
  view: AdvisorReportView;
  outline: AdvisorReportOutlineItem[];
  oneTimeInvalid: boolean;
}

function buildInternalReport(options: {
  oneTimeAmountCents: number | null;
  asOfDate: string;
  now: Date;
}): AdvisorReport {
  const {
    balance,
    properties,
    contracts,
    exclusionByPotId,
    latestSnapshot,
  } = loadHouseholdBalance(options.asOfDate);
  const planningBase = loadPlanningBase();
  const recommendationState = loadRecommendationState({
    asOfDate: options.asOfDate,
    base: planningBase,
  });
  const history = listBalanceSnapshots();

  const mergedPots = planningBase.pots.map((pot) => ({
    id: pot.id,
    name: pot.name,
    priority: pot.priority,
    purpose: pot.purpose,
    currentCents: pot.currentCents,
    targetCents: pot.targetCents,
    targetDate: pot.targetDate,
    ruleType: pot.ruleType,
    fixedMonthlyCents: pot.fixedMonthlyCents,
    remainderPercentage: pot.remainderPercentage,
    linkedContractId: pot.linkedContractId,
    linkedPropertyId: pot.linkedPropertyId,
    liquidityExclusion: exclusionByPotId.get(pot.id) ?? null,
  }));

  return buildAdvisorReport({
    asOfDate: options.asOfDate,
    generatedAt: options.now.toISOString(),
    snapshotFetchedAt: latestSnapshot?.fetchedAt ?? null,
    isDummyHousehold: planningBase.isDummy,
    balance,
    properties,
    contracts,
    pots: mergedPots,
    cashflow: planningBase.consolidated,
    history,
    recommendationState,
    oneTimeAmountCents: options.oneTimeAmountCents,
  });
}

/**
 * Loads the advisor report read-only and returns only the rendered view
 * (and outline). Raw report and entity labels never leave this function.
 */
export function loadAdvisorReport(
  options: LoadAdvisorReportOptions,
): LoadAdvisorReportResult {
  const asOfDate = options.asOfDate ?? getTodayIsoDate();
  const now = options.now ?? new Date();
  const parsedOneTime = parseAdvisorOneTimeAmount(options.oneTimeRaw);

  const report = buildInternalReport({
    oneTimeAmountCents: parsedOneTime.cents,
    asOfDate,
    now,
  });

  const view = buildAdvisorReportView(report, options.mode);
  if (options.mode === "anonymized") {
    assertAnonymizedViewClean(view, collectSensitiveStrings(report));
  }

  return {
    view,
    outline: buildAdvisorReportOutline(report),
    oneTimeInvalid: parsedOneTime.invalid || view.recommendations.oneTimeInvalid,
  };
}

/**
 * Loads only the section outline counts for the cockpit dialog (no entity strings).
 */
export function loadAdvisorReportOutline(
  asOfDate: string = getTodayIsoDate(),
): AdvisorReportOutlineItem[] {
  const report = buildInternalReport({
    oneTimeAmountCents: null,
    asOfDate,
    now: new Date(),
  });
  return buildAdvisorReportOutline(report);
}

/**
 * Server-only helper for POST /api/report/advisor/question-check.
 * Never expose these strings to any client response.
 */
export function loadAdvisorSensitiveStrings(): string[] {
  const unique = new Set<string>();
  const add = (value: string | null | undefined) => {
    if (typeof value !== "string") return;
    const normalized = value
      .normalize("NFKC")
      .trim()
      .replace(/\s+/g, " ")
      .toLowerCase();
    if (normalized.length >= 3) {
      unique.add(normalized);
    }
  };

  for (const contract of listContracts()) {
    add(contract.name);
    add(contract.provider);
    add(contract.milestoneLabel);
    add(contract.loanOptionsNote);
  }
  for (const property of listProperties()) {
    add(property.name);
  }
  for (const pot of listPots()) {
    add(pot.name);
  }

  return Array.from(unique).sort();
}
