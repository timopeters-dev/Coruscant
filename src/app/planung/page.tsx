import { buildRefLabelMap, loadInvestmentContextInput } from "@/db/queries/coach";
import { loadPlanningBase } from "@/db/queries/planning-base";
import { addMonthsToYearMonth, getTodayIsoDate, toYearMonth } from "@/lib/domain/date";
import { buildInvestmentContext } from "@/lib/domain/investment-context";
import { buildPrepaymentDefaults } from "@/lib/domain/scenarios";
import type { DomainPot } from "@/lib/domain/waterfall";
import { PlanungWorkspace } from "@/components/planung/planung-workspace";
import type { LoanOption } from "@/components/planung/prepayment-vs-etf-card";

export const dynamic = "force-dynamic";

export default function PlanungPage() {
  const asOfDate = getTodayIsoDate();
  const base = loadPlanningBase();
  const { contracts, consolidated } = base;

  const loanOptions: LoanOption[] = contracts
    .filter((c) => c.category === "loan" && c.status === "active")
    .map((c) => ({
      id: c.id,
      name: c.name,
      provider: c.provider,
      defaults: buildPrepaymentDefaults(c, asOfDate),
    }));

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

  // Server-seitig gebauter, anonymisierter Kontext; Labels bleiben lokal in der UI.
  const coachInput = loadInvestmentContextInput({ asOfDate, base });

  return (
    <PlanungWorkspace
      asOfDate={asOfDate}
      loanOptions={loanOptions}
      baseSurplusCents={consolidated.monthlySurplusCents}
      hasHouseholdData={consolidated.hasHouseholdData}
      isDummy={base.isDummy}
      pots={pots}
      startMonth={addMonthsToYearMonth(toYearMonth(asOfDate), 1)}
      coachContext={buildInvestmentContext(coachInput)}
      coachRefLabels={buildRefLabelMap(coachInput)}
    />
  );
}
