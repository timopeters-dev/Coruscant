import { loadPlanningBase } from "@/backend/db/queries/planning-base";
import { getTodayIsoDate } from "@/domain/core/date";
import type { EquityPotOption } from "@/frontend/planung/purchase-calculator-state";
import { PurchaseCalculatorWorkspace } from "@/frontend/planung/purchase-calculator-workspace";

export const dynamic = "force-dynamic";

export default function PurchaseCalculatorPage() {
  const asOfDate = getTodayIsoDate();
  const base = loadPlanningBase();

  const pots: EquityPotOption[] = base.pots.map((p) => ({
    id: p.id,
    name: p.name,
    priority: p.priority,
    currentCents: p.currentCents,
    targetCents: p.targetCents,
    targetDate: p.targetDate,
    ruleType: p.ruleType,
    fixedMonthlyCents: p.fixedMonthlyCents,
    remainderPercentage: p.remainderPercentage,
    purpose: p.purpose,
  }));

  return (
    <PurchaseCalculatorWorkspace
      asOfDate={asOfDate}
      monthlySurplusCents={base.consolidated.monthlySurplusCents}
      hasHouseholdData={base.consolidated.hasHouseholdData}
      isDummy={base.isDummy}
      pots={pots}
    />
  );
}
