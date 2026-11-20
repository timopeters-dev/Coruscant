import * as React from "react";
import { redirect } from "next/navigation";
import { buildRefLabelMap, loadInvestmentContextInput } from "@/backend/db/queries/coach";
import { loadPlanningBase } from "@/backend/db/queries/planning-base";
import { loadRecommendationState } from "@/backend/db/queries/recommendation";
import { contractRecordToDomain } from "@/domain/contracts/contract";
import {
  addMonthsToYearMonth,
  getTodayIsoDate,
  toYearMonth,
} from "@/domain/core/date";
import { buildInvestmentContext } from "@/domain/recommendation/investment-context";
import { recommendUse } from "@/domain/recommendation/recommendation";
import { buildPrepaymentDefaults } from "@/domain/planning/scenarios";
import type { DomainPot } from "@/domain/allocation/waterfall";
import { isDevMode } from "@/backend/dev-mode";
import { PlanungWorkspace } from "@/frontend/planung/planung-workspace";
import { parsePropertyVsEtfQuery } from "@/frontend/planung/property-vs-etf-query";
import {
  parsePlanningEntry,
  parsePlanningLoanId,
  parsePlanningView,
  type LoanOption,
} from "@/frontend/planung/planning-state";

export const dynamic = "force-dynamic";

interface PlanungPageProps {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}

export default async function PlanungPage({ searchParams }: PlanungPageProps) {
  const resolved = searchParams ? await searchParams : {};
  const rawFrage = Array.isArray(resolved.frage)
    ? resolved.frage[0]
    : resolved.frage;
  if (typeof rawFrage === "string" && rawFrage.trim() === "kauf") {
    redirect("/planung/kaufrechner");
  }
  const initialEntry = parsePlanningEntry(resolved.frage);
  const initialView = parsePlanningView(resolved.ansicht);
  const initialPropertyVsEtf = parsePropertyVsEtfQuery(resolved);

  const asOfDate = getTodayIsoDate();
  const base = loadPlanningBase();
  const { contracts, consolidated } = base;

  const loanOptions: LoanOption[] = contracts
    .filter((c) => c.category === "loan" && c.status === "active")
    .map((c) => {
      const domainContract = contractRecordToDomain(c);
      return {
        id: c.id,
        name: c.name,
        provider: c.provider,
        defaults: buildPrepaymentDefaults(domainContract, asOfDate),
        contract: domainContract,
      };
    });

  const initialLoanId = parsePlanningLoanId(resolved.kredit, loanOptions);

  const pots: DomainPot[] = base.pots.map((p) => ({
    id: p.id,
    name: p.name,
    priority: p.priority,
    currentCents: p.currentCents,
    targetCents: p.targetCents,
    ruleType: p.ruleType,
    fixedMonthlyCents: p.fixedMonthlyCents,
    remainderPercentage: p.remainderPercentage,
  }));

  const recommendationState = loadRecommendationState({ asOfDate, base });
  const loanOrder = recommendUse(0, recommendationState).loanOrder;

  const potNames: Record<string, string> = {};
  for (const p of base.pots) potNames[p.id] = p.name;
  const loanNames: Record<string, string> = {};
  for (const c of contracts) {
    if (c.category === "loan") loanNames[c.id] = c.name;
  }

  // Server-seitig gebauter, anonymisierter Kontext; Labels bleiben lokal in der UI.
  const coachInput = loadInvestmentContextInput({ asOfDate, base });
  const showDebug = isDevMode();

  return (
    <React.Suspense fallback={null}>
      <PlanungWorkspace
        initialEntry={initialEntry}
        initialView={initialView}
        initialLoanId={initialLoanId}
        asOfDate={asOfDate}
        loanOptions={loanOptions}
        baseSurplusCents={consolidated.monthlySurplusCents}
        hasHouseholdData={consolidated.hasHouseholdData}
        isDummy={base.isDummy}
        pots={pots}
        startMonth={addMonthsToYearMonth(toYearMonth(asOfDate), 1)}
        coachContext={buildInvestmentContext(coachInput)}
        coachRefLabels={buildRefLabelMap(coachInput, loanOrder)}
        recommendationState={recommendationState}
        recommendationLabels={{ potNames, loanNames }}
        showDebug={showDebug}
        initialPropertyVsEtf={initialPropertyVsEtf}
      />
    </React.Suspense>
  );
}
